/**
 * bsv-anchors - SQLite Storage Layer
 * 
 * Persistent storage for commitments, tree nodes, and anchors.
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { 
  Commitment, 
  CommitmentQuery, 
  Anchor, 
  TreeNode, 
  TreeState,
  AnchorConfig,
  DEFAULT_CONFIG 
} from '../types.js';

// ============================================================================
// Database Schema
// ============================================================================

const SCHEMA = `
-- Commitments table
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  leaf_hash TEXT NOT NULL,
  tree_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_commitments_type ON commitments(type);
CREATE INDEX IF NOT EXISTS idx_commitments_timestamp ON commitments(timestamp);
CREATE INDEX IF NOT EXISTS idx_commitments_tree_index ON commitments(tree_index);

-- Merkle tree nodes
CREATE TABLE IF NOT EXISTS tree_nodes (
  level INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (level, idx)
);

-- Tree state (singleton)
CREATE TABLE IF NOT EXISTS tree_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Anchors
CREATE TABLE IF NOT EXISTS anchors (
  anchor_index INTEGER PRIMARY KEY,
  txid TEXT NOT NULL UNIQUE,
  block_height INTEGER,
  timestamp INTEGER NOT NULL,
  root_hash TEXT NOT NULL,
  commitment_count INTEGER NOT NULL,
  previous_anchor TEXT
);

CREATE INDEX IF NOT EXISTS idx_anchors_txid ON anchors(txid);
CREATE INDEX IF NOT EXISTS idx_anchors_root ON anchors(root_hash);

-- Config
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ============================================================================
// Database Class
// ============================================================================

export class AnchorDatabase {
  private db: Database.Database;
  private readonly dataDir: string;
  
  constructor(dataDir?: string) {
    // Resolve data directory
    this.dataDir = dataDir ?? join(homedir(), '.bsv-anchors');
    
    // Ensure directory exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Open database
    const dbPath = join(this.dataDir, 'anchors.db');
    this.db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    
    // Initialize schema
    this.db.exec(SCHEMA);
  }
  
  // --------------------------------------------------------------------------
  // Commitment Operations
  // --------------------------------------------------------------------------
  
  /**
   * Insert a new commitment.
   */
  insertCommitment(commitment: Commitment): void {
    const stmt = this.db.prepare(`
      INSERT INTO commitments (id, type, payload, signature, timestamp, leaf_hash, tree_index)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      commitment.id,
      commitment.type,
      JSON.stringify(commitment.payload),
      commitment.signature,
      commitment.timestamp,
      commitment.leafHash ?? '',
      commitment.treeIndex ?? -1
    );
  }
  
  /**
   * Update commitment with tree position.
   */
  updateCommitmentTree(id: string, leafHash: string, treeIndex: number): void {
    const stmt = this.db.prepare(`
      UPDATE commitments SET leaf_hash = ?, tree_index = ? WHERE id = ?
    `);
    stmt.run(leafHash, treeIndex, id);
  }
  
  /**
   * Get commitment by ID.
   */
  getCommitment(id: string): Commitment | null {
    const stmt = this.db.prepare(`
      SELECT * FROM commitments WHERE id = ?
    `);
    const row = stmt.get(id) as CommitmentRow | undefined;
    return row ? this.rowToCommitment(row) : null;
  }
  
  /**
   * Get commitment by tree index.
   */
  getCommitmentByIndex(treeIndex: number): Commitment | null {
    const stmt = this.db.prepare(`
      SELECT * FROM commitments WHERE tree_index = ?
    `);
    const row = stmt.get(treeIndex) as CommitmentRow | undefined;
    return row ? this.rowToCommitment(row) : null;
  }
  
  /**
   * Query commitments with filters.
   */
  queryCommitments(query: CommitmentQuery): Commitment[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    
    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }
    
    if (query.subject) {
      conditions.push("json_extract(payload, '$.subject') LIKE ?");
      params.push(`%${query.subject}%`);
    }
    
    if (query.counterparty) {
      conditions.push("json_extract(payload, '$.counterparty') = ?");
      params.push(query.counterparty);
    }
    
    if (query.since) {
      conditions.push('timestamp >= ?');
      params.push(query.since);
    }
    
    if (query.until) {
      conditions.push('timestamp <= ?');
      params.push(query.until);
    }
    
    let sql = 'SELECT * FROM commitments';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY timestamp DESC';
    
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }
    
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as CommitmentRow[];
    return rows.map(row => this.rowToCommitment(row));
  }
  
  /**
   * Get all commitments (for tree rebuilding).
   */
  getAllCommitments(): Commitment[] {
    const stmt = this.db.prepare(`
      SELECT * FROM commitments ORDER BY tree_index ASC
    `);
    const rows = stmt.all() as CommitmentRow[];
    return rows.map(row => this.rowToCommitment(row));
  }
  
  /**
   * Get commitment count.
   */
  getCommitmentCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM commitments');
    const row = stmt.get() as { count: number };
    return row.count;
  }
  
  // --------------------------------------------------------------------------
  // Tree Node Operations
  // --------------------------------------------------------------------------
  
  /**
   * Save tree nodes (batch).
   */
  saveTreeNodes(nodes: TreeNode[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO tree_nodes (level, idx, hash) VALUES (?, ?, ?)
    `);
    
    const transaction = this.db.transaction((nodes: TreeNode[]) => {
      for (const node of nodes) {
        insert.run(node.level, node.index, node.hash);
      }
    });
    
    transaction(nodes);
  }
  
  /**
   * Get all tree nodes (for tree rebuilding).
   */
  getTreeNodes(): TreeNode[] {
    const stmt = this.db.prepare('SELECT level, idx as "index", hash FROM tree_nodes');
    return stmt.all() as TreeNode[];
  }
  
  /**
   * Clear tree nodes (for rebuild).
   */
  clearTreeNodes(): void {
    this.db.prepare('DELETE FROM tree_nodes').run();
  }
  
  // --------------------------------------------------------------------------
  // Tree State Operations
  // --------------------------------------------------------------------------
  
  /**
   * Get tree state.
   */
  getTreeState(): TreeState {
    const stmt = this.db.prepare('SELECT key, value FROM tree_state');
    const rows = stmt.all() as { key: string; value: string }[];
    
    const state: Record<string, string> = {};
    for (const row of rows) {
      state[row.key] = row.value;
    }
    
    return {
      rootHash: state.root_hash || null,
      leafCount: parseInt(state.leaf_count || '0', 10),
      lastAnchorIndex: parseInt(state.last_anchor_index || '-1', 10),
    };
  }
  
  /**
   * Save tree state.
   */
  saveTreeState(state: TreeState): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO tree_state (key, value) VALUES (?, ?)
    `);
    
    this.db.transaction(() => {
      upsert.run('root_hash', state.rootHash ?? '');
      upsert.run('leaf_count', state.leafCount.toString());
      upsert.run('last_anchor_index', state.lastAnchorIndex.toString());
    })();
  }
  
  // --------------------------------------------------------------------------
  // Anchor Operations
  // --------------------------------------------------------------------------
  
  /**
   * Insert a new anchor.
   */
  insertAnchor(anchor: Anchor): void {
    const stmt = this.db.prepare(`
      INSERT INTO anchors (anchor_index, txid, block_height, timestamp, root_hash, commitment_count, previous_anchor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      anchor.anchorIndex,
      anchor.txid,
      anchor.blockHeight ?? null,
      anchor.timestamp,
      anchor.rootHash,
      anchor.commitmentCount,
      anchor.previousAnchor ?? null
    );
  }
  
  /**
   * Get anchor by index.
   */
  getAnchor(anchorIndex: number): Anchor | null {
    const stmt = this.db.prepare('SELECT * FROM anchors WHERE anchor_index = ?');
    const row = stmt.get(anchorIndex) as AnchorRow | undefined;
    return row ? this.rowToAnchor(row) : null;
  }
  
  /**
   * Get anchor by txid.
   */
  getAnchorByTxid(txid: string): Anchor | null {
    const stmt = this.db.prepare('SELECT * FROM anchors WHERE txid = ?');
    const row = stmt.get(txid) as AnchorRow | undefined;
    return row ? this.rowToAnchor(row) : null;
  }
  
  /**
   * Get latest anchor.
   */
  getLatestAnchor(): Anchor | null {
    const stmt = this.db.prepare('SELECT * FROM anchors ORDER BY anchor_index DESC LIMIT 1');
    const row = stmt.get() as AnchorRow | undefined;
    return row ? this.rowToAnchor(row) : null;
  }
  
  /**
   * Get all anchors.
   */
  getAllAnchors(): Anchor[] {
    const stmt = this.db.prepare('SELECT * FROM anchors ORDER BY anchor_index ASC');
    const rows = stmt.all() as AnchorRow[];
    return rows.map(row => this.rowToAnchor(row));
  }
  
  /**
   * Update anchor with block height.
   */
  updateAnchorBlock(txid: string, blockHeight: number): void {
    const stmt = this.db.prepare('UPDATE anchors SET block_height = ? WHERE txid = ?');
    stmt.run(blockHeight, txid);
  }
  
  /**
   * Get anchor count.
   */
  getAnchorCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM anchors');
    const row = stmt.get() as { count: number };
    return row.count;
  }
  
  // --------------------------------------------------------------------------
  // Config Operations
  // --------------------------------------------------------------------------
  
  /**
   * Get config value.
   */
  getConfig(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  
  /**
   * Set config value.
   */
  setConfig(key: string, value: string): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
    stmt.run(key, value);
  }
  
  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------
  
  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }
  
  /**
   * Run in a transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  
  /**
   * Get data directory path.
   */
  getDataDir(): string {
    return this.dataDir;
  }
  
  // --------------------------------------------------------------------------
  // Row Converters
  // --------------------------------------------------------------------------
  
  private rowToCommitment(row: CommitmentRow): Commitment {
    return {
      id: row.id,
      type: row.type as Commitment['type'],
      payload: JSON.parse(row.payload),
      signature: row.signature,
      timestamp: row.timestamp,
      leafHash: row.leaf_hash || undefined,
      treeIndex: row.tree_index >= 0 ? row.tree_index : undefined,
    };
  }
  
  private rowToAnchor(row: AnchorRow): Anchor {
    return {
      anchorIndex: row.anchor_index,
      txid: row.txid,
      blockHeight: row.block_height ?? undefined,
      timestamp: row.timestamp,
      rootHash: row.root_hash,
      commitmentCount: row.commitment_count,
      previousAnchor: row.previous_anchor ?? undefined,
    };
  }
}

// ============================================================================
// Row Types
// ============================================================================

interface CommitmentRow {
  id: string;
  type: string;
  payload: string;
  signature: string;
  timestamp: number;
  leaf_hash: string;
  tree_index: number;
  created_at: number;
}

interface AnchorRow {
  anchor_index: number;
  txid: string;
  block_height: number | null;
  timestamp: number;
  root_hash: string;
  commitment_count: number;
  previous_anchor: string | null;
}
