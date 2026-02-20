/**
 * bsv-anchors - Merkle Tree Implementation
 * 
 * Append-only Merkle tree optimized for commitment storage.
 * Uses SHA256 for all hashing.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { MerkleProof, ProofSibling, TreeNode, TreeState } from '../types.js';

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Hash a leaf node (commitment data).
 * Prefix with 0x00 to differentiate from internal nodes.
 */
export function hashLeaf(data: Uint8Array | string): string {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const prefixed = new Uint8Array([0x00, ...input]);
  return bytesToHex(sha256(prefixed));
}

/**
 * Hash an internal node (two child hashes).
 * Prefix with 0x01 to differentiate from leaves.
 * Order matters: left child always comes first.
 */
export function hashInternal(left: string, right: string): string {
  // No sorting - order is determined by tree position
  const combined = hexToBytes(left + right);
  const prefixed = new Uint8Array([0x01, ...combined]);
  return bytesToHex(sha256(prefixed));
}

/**
 * Hash for a "virtual" right sibling when tree is incomplete.
 * Uses the left sibling's hash doubled.
 */
export function hashSingle(hash: string): string {
  return hashInternal(hash, hash);
}

// ============================================================================
// Merkle Tree Class
// ============================================================================

/**
 * In-memory Merkle tree with append-only semantics.
 * 
 * Design:
 * - Leaves are stored at level 0
 * - Each higher level contains hashes of pairs from level below
 * - Tree grows rightward as new leaves are added
 * - Supports efficient proof generation: O(log n)
 */
export class MerkleTree {
  /** Tree nodes by level, then by index */
  private nodes: Map<number, Map<number, string>> = new Map();
  
  /** Number of leaves */
  private _leafCount: number = 0;
  
  constructor() {
    // Initialize level 0 (leaves)
    this.nodes.set(0, new Map());
  }
  
  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------
  
  /**
   * Add a leaf to the tree.
   * @param data - Raw data to hash and add
   * @returns Leaf hash and index
   */
  addLeaf(data: Uint8Array | string): { hash: string; index: number } {
    const hash = hashLeaf(data);
    const index = this._leafCount;
    
    // Add leaf at level 0
    this.getLevel(0).set(index, hash);
    this._leafCount++;
    
    // Rebuild affected path to root
    this.rebuildPath(index);
    
    return { hash, index };
  }
  
  /**
   * Add a pre-computed leaf hash to the tree.
   * Use when loading from storage.
   */
  addLeafHash(hash: string): number {
    const index = this._leafCount;
    this.getLevel(0).set(index, hash);
    this._leafCount++;
    this.rebuildPath(index);
    return index;
  }
  
  /**
   * Get the current root hash.
   * @returns Root hash, or null if tree is empty
   */
  getRoot(): string | null {
    if (this._leafCount === 0) return null;
    
    const height = this.getHeight();
    const topLevel = this.getLevel(height);
    
    // Root is always at index 0 of the top level
    return topLevel.get(0) ?? null;
  }
  
  /**
   * Get the number of leaves.
   */
  get leafCount(): number {
    return this._leafCount;
  }
  
  /**
   * Get tree state for persistence.
   */
  getState(): TreeState {
    return {
      rootHash: this.getRoot(),
      leafCount: this._leafCount,
      lastAnchorIndex: -1, // Managed by store
    };
  }
  
  /**
   * Generate a Merkle proof for a leaf.
   * @param leafIndex - Index of the leaf to prove
   * @returns Merkle proof, or null if index invalid
   */
  generateProof(leafIndex: number): MerkleProof | null {
    if (leafIndex < 0 || leafIndex >= this._leafCount) {
      return null;
    }
    
    const root = this.getRoot();
    if (!root) return null;
    
    const leafHash = this.getLevel(0).get(leafIndex);
    if (!leafHash) return null;
    
    const siblings: ProofSibling[] = [];
    const height = this.getHeight();
    
    let currentIndex = leafIndex;
    
    for (let level = 0; level < height; level++) {
      const siblingIndex = currentIndex ^ 1; // XOR to get sibling
      const siblingHash = this.getLevel(level).get(siblingIndex);
      
      if (siblingHash !== undefined) {
        // Sibling exists
        const position = currentIndex % 2 === 0 ? 'right' : 'left';
        siblings.push({ hash: siblingHash, position });
      } else {
        // No sibling - this happens on the rightmost path of incomplete trees
        // We need to hash with self
        const selfHash = this.getLevel(level).get(currentIndex)!;
        siblings.push({ hash: selfHash, position: 'right' });
      }
      
      // Move to parent
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    return {
      leafHash,
      leafIndex,
      siblings,
      rootHash: root,
    };
  }
  
  /**
   * Verify a Merkle proof.
   * @param proof - The proof to verify
   * @returns true if proof is valid
   */
  static verifyProof(proof: MerkleProof): boolean {
    let currentHash = proof.leafHash;
    
    for (const sibling of proof.siblings) {
      if (sibling.position === 'left') {
        currentHash = hashInternal(sibling.hash, currentHash);
      } else {
        currentHash = hashInternal(currentHash, sibling.hash);
      }
    }
    
    return currentHash === proof.rootHash;
  }
  
  /**
   * Get all nodes for persistence.
   */
  getAllNodes(): TreeNode[] {
    const result: TreeNode[] = [];
    
    for (const [level, levelMap] of this.nodes) {
      for (const [index, hash] of levelMap) {
        result.push({ level, index, hash });
      }
    }
    
    return result;
  }
  
  /**
   * Load tree from persisted nodes.
   */
  static fromNodes(nodes: TreeNode[]): MerkleTree {
    const tree = new MerkleTree();
    
    // Sort by level, then index
    nodes.sort((a, b) => a.level - b.level || a.index - b.index);
    
    // Count leaves (level 0 nodes)
    const leaves = nodes.filter(n => n.level === 0);
    tree._leafCount = leaves.length;
    
    // Load all nodes
    for (const node of nodes) {
      tree.getLevel(node.level).set(node.index, node.hash);
    }
    
    return tree;
  }
  
  // --------------------------------------------------------------------------
  // Internal Methods
  // --------------------------------------------------------------------------
  
  /**
   * Get or create a level map.
   */
  private getLevel(level: number): Map<number, string> {
    let levelMap = this.nodes.get(level);
    if (!levelMap) {
      levelMap = new Map();
      this.nodes.set(level, levelMap);
    }
    return levelMap;
  }
  
  /**
   * Calculate tree height for current leaf count.
   * Height 0 = single leaf, height 1 = 2 leaves, etc.
   */
  private getHeight(): number {
    if (this._leafCount <= 1) return 0;
    return Math.ceil(Math.log2(this._leafCount));
  }
  
  /**
   * Rebuild the path from a leaf to the root.
   * Called after adding a new leaf.
   */
  private rebuildPath(leafIndex: number): void {
    const height = this.getHeight();
    let currentIndex = leafIndex;
    
    for (let level = 0; level < height; level++) {
      const parentIndex = Math.floor(currentIndex / 2);
      const leftChildIndex = parentIndex * 2;
      const rightChildIndex = leftChildIndex + 1;
      
      const leftHash = this.getLevel(level).get(leftChildIndex);
      const rightHash = this.getLevel(level).get(rightChildIndex);
      
      let parentHash: string;
      
      if (leftHash && rightHash) {
        parentHash = hashInternal(leftHash, rightHash);
      } else if (leftHash) {
        // Only left child exists - hash with itself
        parentHash = hashSingle(leftHash);
      } else {
        // Should never happen if tree is built correctly
        throw new Error(`Invalid tree state at level ${level}, index ${leftChildIndex}`);
      }
      
      this.getLevel(level + 1).set(parentIndex, parentHash);
      currentIndex = parentIndex;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Canonicalize a commitment for hashing.
 * Ensures consistent serialization regardless of property order.
 */
export function canonicalizeCommitment(commitment: {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
  signature: string;
}): string {
  // Sort keys and stringify deterministically
  const canonical = {
    id: commitment.id,
    payload: sortObjectKeys(commitment.payload),
    signature: commitment.signature,
    timestamp: commitment.timestamp,
    type: commitment.type,
  };
  
  return JSON.stringify(canonical);
}

/**
 * Recursively sort object keys for deterministic serialization.
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  
  return sorted;
}
