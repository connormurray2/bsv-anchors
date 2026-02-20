/**
 * bsv-anchors - Verifiable Agent Memory
 * 
 * Anchor commitments to BSV blockchain, prove them anywhere.
 */

// Core types
export type {
  Commitment,
  CommitmentInput,
  CommitmentPayload,
  CommitmentType,
  CommitmentQuery,
  CommitmentProof,
  MerkleProof,
  ProofSibling,
  Anchor,
  TreeNode,
  TreeState,
  AnchorConfig,
} from './types.js';

// Main API
export { AnchorStore } from './store/anchor-store.js';

// Merkle tree (for advanced use)
export { 
  MerkleTree,
  hashLeaf,
  hashInternal,
  canonicalizeCommitment,
} from './merkle/tree.js';

// Crypto utilities
export {
  generateKeyPair,
  getPublicKey,
  sign,
  verify,
  type KeyPair,
} from './crypto/signing.js';

// Database (for advanced use)
export { AnchorDatabase } from './store/database.js';

// Wallet integration
export {
  checkWallet,
  getBalance,
  getAddress,
  verifyAnchorOnChain,
  getAnchorData,
  parseAnchorPayload,
  type WalletStatus,
  type BroadcastResult,
} from './wallet/index.js';

// P2P proof protocol
export {
  PROTOCOL_ID,
  ProofHandler,
  ProofClient,
  type ProofHandlerConfig,
  type ProofClientConfig,
  type P2PTransport,
  type ProofMessage,
  type ProofRequest,
  type ProofResponse,
  encodeMessage,
  decodeMessage,
  createProofRequest,
} from './p2p/index.js';

// OpenClaw plugin
export {
  AnchorsPlugin,
  createPlugin,
  TOOL_DEFINITIONS,
  type PluginConfig,
  type ToolResult,
  type ToolDefinition,
} from './openclaw/index.js';
