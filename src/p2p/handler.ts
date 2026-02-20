/**
 * bsv-anchors - P2P Protocol Handler
 * 
 * Handles incoming proof requests and manages proof exchange.
 */

import type { AnchorStore } from '../store/anchor-store.js';
import type { CommitmentProof, CommitmentQuery } from '../types.js';
import {
  PROTOCOL_ID,
  type ProofMessage,
  type ProofRequest,
  type ProofResponse,
  type ProofPush,
  type ProofAck,
  type ProofError,
  encodeMessage,
  decodeMessage,
  createProofResponse,
  createProofAck,
  createProofError,
  createProofPush,
  validateRequest,
} from './protocol.js';

// ============================================================================
// Types
// ============================================================================

export interface ProofHandlerConfig {
  /** The anchor store to use */
  store: AnchorStore;
  
  /** Maximum proofs to return per request */
  maxProofsPerRequest?: number;
  
  /** Whether to include public key in responses */
  includePublicKey?: boolean;
  
  /** Rate limit: max requests per minute per peer */
  rateLimitPerMinute?: number;
  
  /** Callback when a proof is pushed to us */
  onProofReceived?: (proof: CommitmentProof, publicKey: string, peerId: string) => void;
}

export interface PendingRequest {
  requestId: string;
  resolve: (response: ProofResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// Proof Handler
// ============================================================================

export class ProofHandler {
  private store: AnchorStore;
  private config: Required<ProofHandlerConfig>;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private rateLimits: Map<string, number[]> = new Map(); // peerId -> timestamps
  
  constructor(config: ProofHandlerConfig) {
    this.store = config.store;
    this.config = {
      store: config.store,
      maxProofsPerRequest: config.maxProofsPerRequest ?? 50,
      includePublicKey: config.includePublicKey ?? true,
      rateLimitPerMinute: config.rateLimitPerMinute ?? 60,
      onProofReceived: config.onProofReceived ?? (() => {}),
    };
  }
  
  /**
   * Get the protocol ID for registration.
   */
  get protocolId(): string {
    return PROTOCOL_ID;
  }
  
  /**
   * Handle an incoming message from a peer.
   */
  async handleMessage(data: Uint8Array, peerId: string): Promise<Uint8Array | null> {
    try {
      const message = decodeMessage(data);
      
      switch (message.type) {
        case 'PROOF_REQUEST':
          return this.handleRequest(message, peerId);
          
        case 'PROOF_RESPONSE':
          this.handleResponse(message);
          return null; // No response needed
          
        case 'PROOF_PUSH':
          return this.handlePush(message, peerId);
          
        case 'PROOF_ACK':
          // Handle acknowledgment (could track delivery)
          return null;
          
        case 'PROOF_ERROR':
          this.handleError(message);
          return null;
          
        default:
          return encodeMessage(createProofError(
            'INVALID_REQUEST',
            `Unknown message type`,
          ));
      }
    } catch (error) {
      return encodeMessage(createProofError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
      ));
    }
  }
  
  /**
   * Handle a proof request.
   */
  private async handleRequest(request: ProofRequest, peerId: string): Promise<Uint8Array> {
    // Rate limiting
    if (!this.checkRateLimit(peerId)) {
      return encodeMessage(createProofError(
        'RATE_LIMITED',
        'Too many requests. Please slow down.',
        { requestId: request.requestId }
      ));
    }
    
    // Validate request
    const validation = validateRequest(request);
    if (!validation.valid) {
      return encodeMessage(createProofError(
        'INVALID_REQUEST',
        validation.error!,
        { requestId: request.requestId }
      ));
    }
    
    try {
      const proofs: CommitmentProof[] = [];
      
      if (request.commitmentId) {
        // Specific commitment requested
        const proof = await this.store.prove(request.commitmentId);
        if (proof) {
          proofs.push(proof);
        }
      } else if (request.query) {
        // Query for commitments
        const query: CommitmentQuery = {
          type: request.query.type,
          subject: request.query.subject,
          counterparty: request.query.counterparty,
          since: request.query.since,
          until: request.query.until,
          limit: Math.min(request.query.limit ?? 50, this.config.maxProofsPerRequest),
        };
        
        const commitments = await this.store.query(query);
        
        // Generate proofs for each commitment
        for (const commitment of commitments) {
          const proof = await this.store.prove(commitment.id);
          if (proof) {
            // Check anchored requirement
            if (request.options?.requireAnchored && !proof.anchor.blockHeight) {
              continue;
            }
            
            // Check confirmations requirement
            if (request.options?.minConfirmations && proof.anchor.blockHeight) {
              // Would need current block height to check - skip for now
            }
            
            proofs.push(proof);
          }
        }
      }
      
      // Build response
      const response = createProofResponse(request.requestId, proofs, {
        publicKey: (request.options?.includePublicKey || this.config.includePublicKey) 
          ? this.store.getPublicKey() 
          : undefined,
        total: proofs.length,
      });
      
      return encodeMessage(response);
    } catch (error) {
      return encodeMessage(createProofError(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Failed to generate proofs',
        { requestId: request.requestId }
      ));
    }
  }
  
  /**
   * Handle a proof response (for pending requests).
   */
  private handleResponse(response: ProofResponse): void {
    const pending = this.pendingRequests.get(response.requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.requestId);
      pending.resolve(response);
    }
  }
  
  /**
   * Handle a pushed proof.
   */
  private async handlePush(push: ProofPush, peerId: string): Promise<Uint8Array> {
    try {
      // Verify the proof
      const isValid = await AnchorStore.verify(push.proof, push.publicKey);
      
      if (isValid) {
        // Notify callback
        this.config.onProofReceived(push.proof, push.publicKey, peerId);
      }
      
      return encodeMessage(createProofAck(push.pushId, true, { verified: isValid }));
    } catch (error) {
      return encodeMessage(createProofAck(push.pushId, false, {
        error: error instanceof Error ? error.message : 'Verification failed',
      }));
    }
  }
  
  /**
   * Handle an error message.
   */
  private handleError(error: ProofError): void {
    // Check if this is for a pending request
    if (error.requestId) {
      const pending = this.pendingRequests.get(error.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(error.requestId);
        pending.reject(new Error(`${error.code}: ${error.message}`));
      }
    }
  }
  
  /**
   * Check and update rate limit for a peer.
   */
  private checkRateLimit(peerId: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    
    let timestamps = this.rateLimits.get(peerId) ?? [];
    
    // Remove old timestamps
    timestamps = timestamps.filter(t => now - t < windowMs);
    
    if (timestamps.length >= this.config.rateLimitPerMinute) {
      return false;
    }
    
    timestamps.push(now);
    this.rateLimits.set(peerId, timestamps);
    
    return true;
  }
  
  // --------------------------------------------------------------------------
  // Outgoing Requests
  // --------------------------------------------------------------------------
  
  /**
   * Create a proof request message.
   */
  createRequest(params: {
    commitmentId?: string;
    query?: ProofRequest['query'];
    options?: ProofRequest['options'];
  }): { message: Uint8Array; requestId: string } {
    const request: ProofRequest = {
      type: 'PROOF_REQUEST',
      requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      commitmentId: params.commitmentId,
      query: params.query,
      options: params.options,
    };
    
    return {
      message: encodeMessage(request),
      requestId: request.requestId,
    };
  }
  
  /**
   * Register a pending request (for tracking responses).
   */
  registerPendingRequest(
    requestId: string, 
    timeoutMs: number = 30000
  ): Promise<ProofResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeoutMs);
      
      this.pendingRequests.set(requestId, { requestId, resolve, reject, timeout });
    });
  }
  
  /**
   * Create a proof push message.
   */
  createPush(
    commitmentId: string,
    reason?: ProofPush['reason']
  ): Promise<{ message: Uint8Array; pushId: string } | null> {
    return this.store.prove(commitmentId).then(proof => {
      if (!proof) return null;
      
      const push = createProofPush(proof, this.store.getPublicKey(), reason);
      
      return {
        message: encodeMessage(push),
        pushId: push.pushId,
      };
    });
  }
  
  /**
   * Handle a raw response (for external transport).
   */
  processResponse(data: Uint8Array): void {
    try {
      const message = decodeMessage(data);
      if (message.type === 'PROOF_RESPONSE') {
        this.handleResponse(message);
      } else if (message.type === 'PROOF_ERROR') {
        this.handleError(message);
      }
    } catch {
      // Ignore invalid messages
    }
  }
}

// Import for verification
import { AnchorStore } from '../store/anchor-store.js';
