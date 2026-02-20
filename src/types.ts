/**
 * bsv-anchors - Core Types
 * 
 * Commitment types for verifiable agent memory.
 */

// ============================================================================
// Commitment Types
// ============================================================================

export type CommitmentType = 'agreement' | 'attestation' | 'state' | 'custom';

/**
 * A commitment is a statement an agent wants to remember and potentially prove.
 */
export interface Commitment {
  /** Unique identifier (commit_<random>) */
  id: string;
  
  /** Type of commitment */
  type: CommitmentType;
  
  /** The actual content */
  payload: CommitmentPayload;
  
  /** Agent's Ed25519 signature over canonical payload */
  signature: string;
  
  /** Unix timestamp (ms) when created */
  timestamp: number;
  
  /** SHA256 hash of canonical commitment (set after insertion) */
  leafHash?: string;
  
  /** Tree index (set after insertion) */
  treeIndex?: number;
}

export interface CommitmentPayload {
  /** What this commitment is about */
  subject: string;
  
  /** The commitment text/data */
  content: string;
  
  /** PeerId or BSV address of counterparty (if bilateral) */
  counterparty?: string;
  
  /** Additional structured data */
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a new commitment (before signing)
 */
export interface CommitmentInput {
  type: CommitmentType;
  payload: CommitmentPayload;
}

// ============================================================================
// Merkle Tree Types
// ============================================================================

/**
 * A node in the Merkle tree.
 */
export interface TreeNode {
  /** Level in tree (0 = leaves) */
  level: number;
  
  /** Index at this level */
  index: number;
  
  /** SHA256 hash */
  hash: string;
}

/**
 * Current state of the Merkle tree.
 */
export interface TreeState {
  /** Current root hash (or null if empty) */
  rootHash: string | null;
  
  /** Number of leaves (commitments) */
  leafCount: number;
  
  /** Index of last anchor */
  lastAnchorIndex: number;
}

/**
 * Merkle proof for a single commitment.
 */
export interface MerkleProof {
  /** Hash of the leaf being proven */
  leafHash: string;
  
  /** Index of the leaf */
  leafIndex: number;
  
  /** Sibling hashes from leaf to root */
  siblings: ProofSibling[];
  
  /** Root hash this proof validates against */
  rootHash: string;
}

export interface ProofSibling {
  /** Hash of the sibling node */
  hash: string;
  
  /** Position relative to path node: 'left' or 'right' */
  position: 'left' | 'right';
}

// ============================================================================
// Anchor Types
// ============================================================================

/**
 * An anchor is a blockchain transaction proving a tree root existed at a time.
 */
export interface Anchor {
  /** BSV transaction ID */
  txid: string;
  
  /** Block height (once confirmed) */
  blockHeight?: number;
  
  /** Block timestamp (or broadcast timestamp if unconfirmed) */
  timestamp: number;
  
  /** Merkle root that was anchored */
  rootHash: string;
  
  /** Number of commitments in tree at anchor time */
  commitmentCount: number;
  
  /** Sequential anchor number */
  anchorIndex: number;
  
  /** Previous anchor txid (for chain verification) */
  previousAnchor?: string;
}

/**
 * Full proof of a commitment, including anchor reference.
 */
export interface CommitmentProof {
  /** The commitment being proven */
  commitment: Commitment;
  
  /** Merkle inclusion proof */
  merkleProof: MerkleProof;
  
  /** Anchor reference */
  anchor: {
    txid: string;
    blockHeight?: number;
    timestamp: number;
  };
}

// ============================================================================
// Query Types
// ============================================================================

export interface CommitmentQuery {
  /** Filter by type */
  type?: CommitmentType;
  
  /** Filter by subject (substring match) */
  subject?: string;
  
  /** Filter by counterparty */
  counterparty?: string;
  
  /** Filter by timestamp (after) */
  since?: number;
  
  /** Filter by timestamp (before) */
  until?: number;
  
  /** Maximum results */
  limit?: number;
  
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface AnchorConfig {
  /** Path to data directory */
  dataDir: string;
  
  /** Anchoring strategy */
  anchorStrategy: 'manual' | 'time' | 'count' | 'importance';
  
  /** For time strategy: hours between anchors */
  anchorIntervalHours?: number;
  
  /** For count strategy: commits before anchor */
  anchorThreshold?: number;
  
  /** For importance strategy: types to anchor immediately */
  immediateTypes?: CommitmentType[];
}

export const DEFAULT_CONFIG: AnchorConfig = {
  dataDir: '~/.bsv-anchors',
  anchorStrategy: 'manual',
};
