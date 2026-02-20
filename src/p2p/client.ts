/**
 * bsv-anchors - P2P Proof Client
 * 
 * High-level client for requesting proofs from peers via bsv-p2p.
 */

import type { CommitmentProof, CommitmentType } from '../types.js';
import { AnchorStore } from '../store/anchor-store.js';
import { ProofHandler } from './handler.js';
import {
  PROTOCOL_ID,
  type ProofRequest,
  type ProofResponse,
  encodeMessage,
  decodeMessage,
  createProofRequest,
} from './protocol.js';

// ============================================================================
// Types
// ============================================================================

export interface P2PTransport {
  /**
   * Send a message to a peer and get a response.
   */
  request(peerId: string, protocolId: string, data: Uint8Array): Promise<Uint8Array>;
  
  /**
   * Send a message without expecting a response.
   */
  send?(peerId: string, protocolId: string, data: Uint8Array): Promise<void>;
}

export interface ProofClientConfig {
  /** The anchor store */
  store: AnchorStore;
  
  /** Transport for P2P communication */
  transport: P2PTransport;
  
  /** Request timeout in ms */
  timeoutMs?: number;
}

// ============================================================================
// Proof Client
// ============================================================================

export class ProofClient {
  private store: AnchorStore;
  private transport: P2PTransport;
  private timeoutMs: number;
  private handler: ProofHandler;
  
  constructor(config: ProofClientConfig) {
    this.store = config.store;
    this.transport = config.transport;
    this.timeoutMs = config.timeoutMs ?? 30000;
    
    this.handler = new ProofHandler({
      store: config.store,
      onProofReceived: (proof, publicKey, peerId) => {
        // Default: just log
        console.log(`[P2P] Received proof from ${peerId}: ${proof.commitment.id}`);
      },
    });
  }
  
  /**
   * Request a specific commitment proof from a peer.
   */
  async requestProof(peerId: string, commitmentId: string): Promise<CommitmentProof | null> {
    const request = createProofRequest({
      commitmentId,
      options: { includePublicKey: true },
    });
    
    const responseData = await this.transport.request(
      peerId,
      PROTOCOL_ID,
      encodeMessage(request)
    );
    
    const response = decodeMessage(responseData) as ProofResponse;
    
    if (response.type !== 'PROOF_RESPONSE') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return response.proofs[0] ?? null;
  }
  
  /**
   * Query proofs from a peer.
   */
  async queryProofs(peerId: string, query: {
    type?: CommitmentType;
    subject?: string;
    counterparty?: string;
    since?: Date | number;
    until?: Date | number;
    limit?: number;
  }): Promise<{ proofs: CommitmentProof[]; publicKey?: string }> {
    const request = createProofRequest({
      query: {
        type: query.type,
        subject: query.subject,
        counterparty: query.counterparty,
        since: query.since instanceof Date ? query.since.getTime() : query.since,
        until: query.until instanceof Date ? query.until.getTime() : query.until,
        limit: query.limit,
      },
      options: { includePublicKey: true, requireAnchored: true },
    });
    
    const responseData = await this.transport.request(
      peerId,
      PROTOCOL_ID,
      encodeMessage(request)
    );
    
    const response = decodeMessage(responseData) as ProofResponse;
    
    if (response.type !== 'PROOF_RESPONSE') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    return {
      proofs: response.proofs,
      publicKey: response.publicKey,
    };
  }
  
  /**
   * Request all agreement proofs with a specific counterparty.
   */
  async getAgreementsWith(peerId: string, myPeerId: string): Promise<CommitmentProof[]> {
    const result = await this.queryProofs(peerId, {
      type: 'agreement',
      counterparty: myPeerId,
    });
    return result.proofs;
  }
  
  /**
   * Request identity attestations from a peer.
   */
  async getAttestations(peerId: string): Promise<CommitmentProof[]> {
    const result = await this.queryProofs(peerId, {
      type: 'attestation',
    });
    return result.proofs;
  }
  
  /**
   * Verify proofs received from a peer.
   */
  async verifyProofs(proofs: CommitmentProof[], publicKey: string): Promise<{
    valid: CommitmentProof[];
    invalid: Array<{ proof: CommitmentProof; error: string }>;
  }> {
    const valid: CommitmentProof[] = [];
    const invalid: Array<{ proof: CommitmentProof; error: string }> = [];
    
    for (const proof of proofs) {
      try {
        const isValid = await AnchorStore.verify(proof, publicKey);
        if (isValid) {
          valid.push(proof);
        } else {
          invalid.push({ proof, error: 'Signature verification failed' });
        }
      } catch (error) {
        invalid.push({ 
          proof, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    return { valid, invalid };
  }
  
  /**
   * Push a proof to a peer (proactive sharing).
   */
  async pushProof(peerId: string, commitmentId: string): Promise<boolean> {
    const pushData = await this.handler.createPush(commitmentId, 'bilateral');
    if (!pushData) return false;
    
    if (this.transport.send) {
      await this.transport.send(peerId, PROTOCOL_ID, pushData.message);
      return true;
    }
    
    // Fallback to request/response
    await this.transport.request(peerId, PROTOCOL_ID, pushData.message);
    return true;
  }
  
  /**
   * Get the protocol handler for registering with bsv-p2p.
   */
  getHandler(): ProofHandler {
    return this.handler;
  }
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Create a simple HTTP transport for testing.
 * In production, use bsv-p2p's stream protocol.
 */
export function createHttpTransport(baseUrl: string): P2PTransport {
  return {
    async request(peerId: string, protocolId: string, data: Uint8Array): Promise<Uint8Array> {
      const response = await fetch(`${baseUrl}/p2p/${peerId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Protocol-Id': protocolId,
        },
        body: data,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    },
  };
}

/**
 * Example bsv-p2p integration:
 * 
 * ```typescript
 * import { createLibp2p } from 'libp2p';
 * import { ProofClient, ProofHandler, PROTOCOL_ID } from 'bsv-anchors/p2p';
 * 
 * // Create libp2p node (from bsv-p2p)
 * const node = await createLibp2p({ ... });
 * 
 * // Create proof handler
 * const store = await AnchorStore.open();
 * const handler = new ProofHandler({ store });
 * 
 * // Register protocol handler
 * await node.handle(PROTOCOL_ID, async ({ stream }) => {
 *   const data = await readStream(stream);
 *   const response = await handler.handleMessage(data, stream.remotePeer.toString());
 *   if (response) {
 *     await writeStream(stream, response);
 *   }
 * });
 * 
 * // Create client with libp2p transport
 * const client = new ProofClient({
 *   store,
 *   transport: {
 *     async request(peerId, protocolId, data) {
 *       const stream = await node.dialProtocol(peerId, protocolId);
 *       await writeStream(stream, data);
 *       return await readStream(stream);
 *     }
 *   }
 * });
 * 
 * // Request proofs from a peer
 * const proofs = await client.queryProofs(peerId, { type: 'agreement' });
 * ```
 */
