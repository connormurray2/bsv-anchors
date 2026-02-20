/**
 * bsv-anchors - P2P Proof Protocol
 * 
 * Protocol for requesting and exchanging commitment proofs over bsv-p2p.
 * 
 * Protocol ID: /bsv-anchors/proof/1.0.0
 */

import type { 
  CommitmentProof, 
  CommitmentQuery, 
  CommitmentType,
  Commitment 
} from '../types.js';

// ============================================================================
// Protocol Constants
// ============================================================================

export const PROTOCOL_ID = '/bsv-anchors/proof/1.0.0';
export const PROTOCOL_VERSION = '1.0.0';

// ============================================================================
// Message Types
// ============================================================================

export type ProofMessageType = 
  | 'PROOF_REQUEST'
  | 'PROOF_RESPONSE'
  | 'PROOF_PUSH'
  | 'PROOF_ACK'
  | 'PROOF_ERROR';

/**
 * Request proofs from a peer.
 */
export interface ProofRequest {
  type: 'PROOF_REQUEST';
  requestId: string;
  
  /** Request specific commitment by ID */
  commitmentId?: string;
  
  /** Or query for matching commitments */
  query?: {
    type?: CommitmentType;
    subject?: string;
    counterparty?: string;
    since?: number;
    until?: number;
    limit?: number;
  };
  
  /** Verification requirements */
  options?: {
    /** Only return anchored commitments */
    requireAnchored?: boolean;
    /** Minimum block confirmations */
    minConfirmations?: number;
    /** Include the signer's public key */
    includePublicKey?: boolean;
  };
}

/**
 * Response with proofs.
 */
export interface ProofResponse {
  type: 'PROOF_RESPONSE';
  requestId: string;
  
  /** Matching proofs */
  proofs: CommitmentProof[];
  
  /** Signer's public key (if requested) */
  publicKey?: string;
  
  /** Total matching (may be more than returned) */
  total: number;
  
  /** Error if request failed */
  error?: string;
}

/**
 * Proactively push a proof to a peer.
 */
export interface ProofPush {
  type: 'PROOF_PUSH';
  pushId: string;
  
  /** The proof being pushed */
  proof: CommitmentProof;
  
  /** Signer's public key */
  publicKey: string;
  
  /** Why this is being pushed */
  reason?: 'new_commitment' | 'anchor_confirmed' | 'requested' | 'bilateral';
}

/**
 * Acknowledge receipt of pushed proof.
 */
export interface ProofAck {
  type: 'PROOF_ACK';
  pushId: string;
  
  /** Whether the proof was accepted/verified */
  accepted: boolean;
  
  /** Verification result */
  verified?: boolean;
  
  /** Error if rejected */
  error?: string;
}

/**
 * Error response.
 */
export interface ProofError {
  type: 'PROOF_ERROR';
  requestId?: string;
  pushId?: string;
  
  /** Error code */
  code: ProofErrorCode;
  
  /** Human-readable message */
  message: string;
}

export type ProofErrorCode = 
  | 'NOT_FOUND'
  | 'NOT_ANCHORED'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type ProofMessage = 
  | ProofRequest 
  | ProofResponse 
  | ProofPush 
  | ProofAck 
  | ProofError;

// ============================================================================
// Message Encoding/Decoding
// ============================================================================

/**
 * Encode a proof message to bytes.
 */
export function encodeMessage(message: ProofMessage): Uint8Array {
  const json = JSON.stringify(message);
  return new TextEncoder().encode(json);
}

/**
 * Decode bytes to a proof message.
 */
export function decodeMessage(data: Uint8Array): ProofMessage {
  const json = new TextDecoder().decode(data);
  const message = JSON.parse(json) as ProofMessage;
  
  // Validate message type
  const validTypes: ProofMessageType[] = [
    'PROOF_REQUEST', 'PROOF_RESPONSE', 'PROOF_PUSH', 'PROOF_ACK', 'PROOF_ERROR'
  ];
  
  if (!validTypes.includes(message.type)) {
    throw new Error(`Invalid message type: ${(message as any).type}`);
  }
  
  return message;
}

// ============================================================================
// Request/Response Helpers
// ============================================================================

/**
 * Generate a unique request ID.
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique push ID.
 */
export function generatePushId(): string {
  return `push_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a proof request message.
 */
export function createProofRequest(params: {
  commitmentId?: string;
  query?: ProofRequest['query'];
  options?: ProofRequest['options'];
}): ProofRequest {
  return {
    type: 'PROOF_REQUEST',
    requestId: generateRequestId(),
    commitmentId: params.commitmentId,
    query: params.query,
    options: params.options,
  };
}

/**
 * Create a proof response message.
 */
export function createProofResponse(
  requestId: string,
  proofs: CommitmentProof[],
  options?: { publicKey?: string; total?: number; error?: string }
): ProofResponse {
  return {
    type: 'PROOF_RESPONSE',
    requestId,
    proofs,
    publicKey: options?.publicKey,
    total: options?.total ?? proofs.length,
    error: options?.error,
  };
}

/**
 * Create a proof push message.
 */
export function createProofPush(
  proof: CommitmentProof,
  publicKey: string,
  reason?: ProofPush['reason']
): ProofPush {
  return {
    type: 'PROOF_PUSH',
    pushId: generatePushId(),
    proof,
    publicKey,
    reason,
  };
}

/**
 * Create a proof acknowledgment.
 */
export function createProofAck(
  pushId: string,
  accepted: boolean,
  options?: { verified?: boolean; error?: string }
): ProofAck {
  return {
    type: 'PROOF_ACK',
    pushId,
    accepted,
    verified: options?.verified,
    error: options?.error,
  };
}

/**
 * Create an error response.
 */
export function createProofError(
  code: ProofErrorCode,
  message: string,
  ids?: { requestId?: string; pushId?: string }
): ProofError {
  return {
    type: 'PROOF_ERROR',
    requestId: ids?.requestId,
    pushId: ids?.pushId,
    code,
    message,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a proof request.
 */
export function validateRequest(request: ProofRequest): { valid: boolean; error?: string } {
  if (!request.commitmentId && !request.query) {
    return { valid: false, error: 'Must specify commitmentId or query' };
  }
  
  if (request.query?.limit && request.query.limit > 100) {
    return { valid: false, error: 'Query limit cannot exceed 100' };
  }
  
  return { valid: true };
}
