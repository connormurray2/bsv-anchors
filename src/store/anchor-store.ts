/**
 * bsv-anchors - Anchor Store
 * 
 * Main API for commitment storage and proof generation.
 */

import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { 
  broadcastAnchor, 
  checkWallet, 
  verifyAnchorOnChain,
  parseAnchorPayload,
  type WalletStatus,
  type BroadcastResult
} from '../wallet/integration.js';
import type {
  Commitment,
  CommitmentInput,
  CommitmentQuery,
  CommitmentProof,
  MerkleProof,
  Anchor,
  TreeState,
  AnchorConfig,
} from '../types.js';
import { AnchorDatabase } from './database.js';
import { MerkleTree, canonicalizeCommitment, hashLeaf } from '../merkle/tree.js';
import { loadOrCreateKey, sign, verify, getPublicKey, type KeyPair } from '../crypto/signing.js';

// ============================================================================
// Anchor Store
// ============================================================================

export class AnchorStore {
  private db: AnchorDatabase;
  private tree: MerkleTree;
  private keyPair: KeyPair;
  private config: AnchorConfig;
  
  private constructor(db: AnchorDatabase, tree: MerkleTree, keyPair: KeyPair, config: AnchorConfig) {
    this.db = db;
    this.tree = tree;
    this.keyPair = keyPair;
    this.config = config;
  }
  
  // --------------------------------------------------------------------------
  // Factory Methods
  // --------------------------------------------------------------------------
  
  /**
   * Open or create an anchor store.
   */
  static async open(dataDir?: string): Promise<AnchorStore> {
    const resolvedDir = dataDir ?? join(homedir(), '.bsv-anchors');
    
    // Open database
    const db = new AnchorDatabase(resolvedDir);
    
    // Load or create signing key
    const keyPair = loadOrCreateKey(resolvedDir);
    
    // Load config
    const config: AnchorConfig = {
      dataDir: resolvedDir,
      anchorStrategy: (db.getConfig('anchor_strategy') as AnchorConfig['anchorStrategy']) ?? 'manual',
    };
    
    // Rebuild tree from stored commitments
    const tree = new MerkleTree();
    const commitments = db.getAllCommitments();
    
    for (const commitment of commitments) {
      if (commitment.leafHash) {
        tree.addLeafHash(commitment.leafHash);
      }
    }
    
    return new AnchorStore(db, tree, keyPair, config);
  }
  
  // --------------------------------------------------------------------------
  // Commitment Operations
  // --------------------------------------------------------------------------
  
  /**
   * Create and store a new commitment.
   */
  async commit(input: CommitmentInput): Promise<Commitment> {
    // Generate ID
    const id = 'commit_' + randomBytes(12).toString('hex');
    
    // Create commitment (unsigned)
    const timestamp = Date.now();
    const unsigned = {
      id,
      type: input.type,
      payload: input.payload,
      timestamp,
      signature: '', // Placeholder
    };
    
    // Sign canonical form
    const canonical = canonicalizeCommitment({ ...unsigned, signature: '' });
    const signature = sign(canonical, this.keyPair.privateKey);
    
    // Create full commitment
    const commitment: Commitment = {
      id,
      type: input.type,
      payload: input.payload,
      timestamp,
      signature,
    };
    
    // Add to tree
    const canonicalFull = canonicalizeCommitment(commitment);
    const { hash, index } = this.tree.addLeaf(canonicalFull);
    
    commitment.leafHash = hash;
    commitment.treeIndex = index;
    
    // Persist
    this.db.transaction(() => {
      this.db.insertCommitment(commitment);
      this.db.saveTreeState(this.tree.getState());
      this.db.saveTreeNodes(this.tree.getAllNodes());
    });
    
    return commitment;
  }
  
  /**
   * Get commitment by ID.
   */
  async get(id: string): Promise<Commitment | null> {
    return this.db.getCommitment(id);
  }
  
  /**
   * Query commitments with filters.
   */
  async query(query: CommitmentQuery): Promise<Commitment[]> {
    return this.db.queryCommitments(query);
  }
  
  /**
   * List all commitments (paginated).
   */
  async list(limit: number = 100, offset: number = 0): Promise<Commitment[]> {
    return this.db.queryCommitments({ limit, offset });
  }
  
  /**
   * Get commitment count.
   */
  async count(): Promise<number> {
    return this.db.getCommitmentCount();
  }
  
  // --------------------------------------------------------------------------
  // Proof Operations
  // --------------------------------------------------------------------------
  
  /**
   * Generate a Merkle proof for a commitment.
   */
  async prove(commitmentId: string): Promise<CommitmentProof | null> {
    const commitment = await this.get(commitmentId);
    if (!commitment || commitment.treeIndex === undefined) {
      return null;
    }
    
    // Generate Merkle proof
    const merkleProof = this.tree.generateProof(commitment.treeIndex);
    if (!merkleProof) {
      return null;
    }
    
    // Find the anchor that includes this commitment
    const anchors = this.db.getAllAnchors();
    
    // Find first anchor after this commitment's tree index
    const anchor = anchors.find(a => a.commitmentCount > commitment.treeIndex!);
    
    if (!anchor) {
      // Commitment not yet anchored
      return null;
    }
    
    return {
      commitment,
      merkleProof,
      anchor: {
        txid: anchor.txid,
        blockHeight: anchor.blockHeight,
        timestamp: anchor.timestamp,
      },
    };
  }
  
  /**
   * Verify Merkle inclusion only (does NOT verify signature).
   * Use verify() for full verification including signature.
   */
  static async verifyInclusion(proof: CommitmentProof): Promise<boolean> {
    // 1. Verify Merkle proof
    if (!MerkleTree.verifyProof(proof.merkleProof)) {
      return false;
    }
    
    // 2. Verify leaf hash matches commitment
    const canonical = canonicalizeCommitment(proof.commitment);
    const expectedHash = hashLeaf(canonical);
    if (expectedHash !== proof.merkleProof.leafHash) {
      return false;
    }
    
    // 3. TODO: Verify anchor exists on-chain
    // This would require bsv-wallet integration
    
    return true;
  }
  
  /**
   * Fully verify a commitment proof including signature.
   * @param proof - The proof to verify
   * @param publicKeyHex - Public key of the commitment creator
   */
  static async verify(proof: CommitmentProof, publicKeyHex: string): Promise<boolean> {
    // First verify Merkle inclusion
    if (!await AnchorStore.verifyInclusion(proof)) {
      return false;
    }
    
    // Verify signature over canonical commitment (unsigned)
    const unsignedCanonical = canonicalizeCommitment({
      ...proof.commitment,
      signature: '',
    });
    
    return verify(unsignedCanonical, proof.commitment.signature, publicKeyHex);
  }
  
  // --------------------------------------------------------------------------
  // Anchor Operations
  // --------------------------------------------------------------------------
  
  /**
   * Get current tree state.
   */
  async getTreeState(): Promise<TreeState> {
    return {
      ...this.tree.getState(),
      lastAnchorIndex: this.db.getTreeState().lastAnchorIndex,
    };
  }
  
  /**
   * Get current root hash.
   */
  async getRoot(): Promise<string | null> {
    return this.tree.getRoot();
  }
  
  /**
   * Check if bsv-wallet is available for anchoring.
   */
  async checkWallet(): Promise<WalletStatus> {
    return checkWallet();
  }
  
  /**
   * Anchor the current tree to the BSV blockchain.
   * Requires bsv-wallet to be installed and initialized.
   * 
   * @param options.feeRate - Sats per byte (default: 0.5)
   * @param options.dryRun - Don't actually broadcast (default: false)
   * @returns Anchor record with txid
   */
  async anchor(options: { feeRate?: number; dryRun?: boolean } = {}): Promise<Anchor> {
    const { feeRate = 0.5, dryRun = false } = options;
    
    // Check for unanchored commitments
    const unanchored = await this.getUnanchoredCount();
    if (unanchored === 0) {
      throw new Error('Nothing to anchor (no new commitments since last anchor)');
    }
    
    // Build payload
    const payload = await this.buildAnchorPayload();
    
    // Broadcast transaction
    const result = await broadcastAnchor({ payload, feeRate, dryRun });
    
    if (!result.success || !result.txid) {
      throw new Error(`Anchor broadcast failed: ${result.error ?? 'Unknown error'}`);
    }
    
    // Record the anchor
    return this.recordAnchor(result.txid);
  }
  
  /**
   * Verify an anchor exists on-chain and update its block height.
   */
  async refreshAnchor(txid: string): Promise<Anchor | null> {
    const anchor = await this.getAnchor(txid);
    if (!anchor) return null;
    
    const verification = await verifyAnchorOnChain(txid);
    
    if (verification.confirmed && verification.blockHeight) {
      this.db.updateAnchorBlock(txid, verification.blockHeight);
      anchor.blockHeight = verification.blockHeight;
    }
    
    return anchor;
  }
  
  /**
   * Record an anchor (after broadcasting tx).
   * Use anchor() for automatic broadcasting, or this for manual recording.
   */
  async recordAnchor(txid: string, timestamp?: number): Promise<Anchor> {
    const state = this.tree.getState();
    const latestAnchor = this.db.getLatestAnchor();
    
    const anchor: Anchor = {
      txid,
      timestamp: timestamp ?? Date.now(),
      rootHash: state.rootHash!,
      commitmentCount: state.leafCount,
      anchorIndex: (latestAnchor?.anchorIndex ?? -1) + 1,
      previousAnchor: latestAnchor?.txid,
    };
    
    this.db.insertAnchor(anchor);
    
    // Update tree state
    const treeState = this.db.getTreeState();
    treeState.lastAnchorIndex = anchor.anchorIndex;
    this.db.saveTreeState(treeState);
    
    return anchor;
  }
  
  /**
   * Get anchor by txid.
   */
  async getAnchor(txid: string): Promise<Anchor | null> {
    return this.db.getAnchorByTxid(txid);
  }
  
  /**
   * Get latest anchor.
   */
  async getLatestAnchor(): Promise<Anchor | null> {
    return this.db.getLatestAnchor();
  }
  
  /**
   * List all anchors.
   */
  async listAnchors(): Promise<Anchor[]> {
    return this.db.getAllAnchors();
  }
  
  /**
   * Get number of unanchored commitments.
   */
  async getUnanchoredCount(): Promise<number> {
    const latestAnchor = await this.getLatestAnchor();
    const totalCount = await this.count();
    
    if (!latestAnchor) {
      return totalCount;
    }
    
    return totalCount - latestAnchor.commitmentCount;
  }
  
  // --------------------------------------------------------------------------
  // Identity
  // --------------------------------------------------------------------------
  
  /**
   * Get this store's public key.
   */
  getPublicKey(): string {
    return this.keyPair.publicKey;
  }
  
  /**
   * Sign arbitrary data with this store's key.
   */
  sign(message: string): string {
    return sign(message, this.keyPair.privateKey);
  }
  
  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------
  
  /**
   * Close the store.
   */
  close(): void {
    this.db.close();
  }
  
  /**
   * Get data directory path.
   */
  getDataDir(): string {
    return this.config.dataDir;
  }
  
  /**
   * Build anchor transaction data.
   * Returns the OP_RETURN payload for anchoring.
   */
  async buildAnchorPayload(): Promise<Uint8Array> {
    const root = this.tree.getRoot();
    if (!root) {
      throw new Error('Cannot anchor empty tree');
    }
    
    const latestAnchor = await this.getLatestAnchor();
    const commitmentCount = await this.count();
    
    // Protocol: "BSV-ANCHOR" <version:1> <root:32> <count:4> <prev:32>
    const protocol = new TextEncoder().encode('BSV-ANCHOR');
    const version = new Uint8Array([0x01]);
    const rootBytes = hexToBytes(root);
    const countBytes = new Uint8Array(4);
    new DataView(countBytes.buffer).setUint32(0, commitmentCount, false); // big-endian
    const prevBytes = latestAnchor 
      ? hexToBytes(latestAnchor.txid)
      : new Uint8Array(32); // zeros if first anchor
    
    // Concatenate
    const payload = new Uint8Array(
      protocol.length + version.length + rootBytes.length + countBytes.length + prevBytes.length
    );
    
    let offset = 0;
    payload.set(protocol, offset); offset += protocol.length;
    payload.set(version, offset); offset += version.length;
    payload.set(rootBytes, offset); offset += rootBytes.length;
    payload.set(countBytes, offset); offset += countBytes.length;
    payload.set(prevBytes, offset);
    
    return payload;
  }
}

// ============================================================================
// Helpers
// ============================================================================

// Using hexToBytes from @noble/hashes/utils (imported in merkle/tree.ts)
import { hexToBytes } from '@noble/hashes/utils';
