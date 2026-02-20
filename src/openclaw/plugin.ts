/**
 * bsv-anchors - OpenClaw Plugin
 * 
 * Provides agent tools for commitment management.
 */

import { AnchorStore } from '../store/anchor-store.js';
import type { CommitmentType, CommitmentProof } from '../types.js';
import { ProofHandler } from '../p2p/handler.js';
import { PROTOCOL_ID } from '../p2p/protocol.js';

// ============================================================================
// Plugin Types
// ============================================================================

export interface PluginConfig {
  /** Data directory for anchor store */
  dataDir?: string;
  
  /** Enable P2P proof protocol */
  enableP2P?: boolean;
  
  /** Rate limit for P2P requests */
  rateLimitPerMinute?: number;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'anchors_commit',
    description: 'Create a new commitment and add it to the local anchor store. Commitments are signed statements that can be anchored to BSV blockchain and proven to others.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['agreement', 'attestation', 'state', 'custom'],
          description: 'Type of commitment: agreement (service contracts), attestation (identity claims), state (channel/system state), custom (other)',
        },
        subject: {
          type: 'string',
          description: 'What this commitment is about (e.g., "code-review", "identity", "channel:123")',
        },
        content: {
          type: 'string',
          description: 'The commitment content/terms',
        },
        counterparty: {
          type: 'string',
          description: 'PeerId or BSV address of the other party (optional)',
        },
      },
      required: ['type', 'subject', 'content'],
    },
  },
  {
    name: 'anchors_list',
    description: 'List commitments in the local anchor store with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['agreement', 'attestation', 'state', 'custom'],
          description: 'Filter by commitment type',
        },
        subject: {
          type: 'string',
          description: 'Filter by subject (substring match)',
        },
        counterparty: {
          type: 'string',
          description: 'Filter by counterparty',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
        },
      },
    },
  },
  {
    name: 'anchors_prove',
    description: 'Generate a cryptographic proof for a commitment. The proof can be shared with others to verify the commitment was anchored on-chain.',
    inputSchema: {
      type: 'object',
      properties: {
        commitmentId: {
          type: 'string',
          description: 'ID of the commitment to prove',
        },
      },
      required: ['commitmentId'],
    },
  },
  {
    name: 'anchors_verify',
    description: 'Verify a commitment proof. Checks Merkle inclusion and optionally signature.',
    inputSchema: {
      type: 'object',
      properties: {
        proof: {
          type: 'object',
          description: 'The proof object to verify',
        },
        publicKey: {
          type: 'string',
          description: 'Public key to verify signature (optional - if omitted, only checks inclusion)',
        },
      },
      required: ['proof'],
    },
  },
  {
    name: 'anchors_anchor',
    description: 'Anchor all pending commitments to the BSV blockchain. Requires bsv-wallet to be installed and funded.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'Preview without broadcasting (default: false)',
        },
        feeRate: {
          type: 'number',
          description: 'Fee rate in sats/byte (default: 0.5)',
        },
      },
    },
  },
  {
    name: 'anchors_status',
    description: 'Get the status of the anchor store including commitment count, tree root, and latest anchor.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'anchors_request',
    description: 'Request commitment proofs from another agent via P2P. Requires bsv-p2p daemon to be running.',
    inputSchema: {
      type: 'object',
      properties: {
        peerId: {
          type: 'string',
          description: 'Target peer ID (12D3KooW...)',
        },
        commitmentId: {
          type: 'string',
          description: 'Specific commitment to request (optional)',
        },
        type: {
          type: 'string',
          enum: ['agreement', 'attestation', 'state', 'custom'],
          description: 'Filter by type (optional)',
        },
        counterparty: {
          type: 'string',
          description: 'Filter by counterparty - usually your own peerId (optional)',
        },
      },
      required: ['peerId'],
    },
  },
];

// ============================================================================
// Plugin Implementation
// ============================================================================

export class AnchorsPlugin {
  private store: AnchorStore | null = null;
  private handler: ProofHandler | null = null;
  private config: PluginConfig;
  
  constructor(config: PluginConfig = {}) {
    this.config = config;
  }
  
  /**
   * Initialize the plugin.
   */
  async initialize(): Promise<void> {
    this.store = await AnchorStore.open(this.config.dataDir);
    
    if (this.config.enableP2P) {
      this.handler = new ProofHandler({
        store: this.store,
        rateLimitPerMinute: this.config.rateLimitPerMinute,
      });
    }
  }
  
  /**
   * Get tool definitions for OpenClaw.
   */
  getTools(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }
  
  /**
   * Get P2P protocol handler for registration.
   */
  getProtocolHandler(): { protocolId: string; handler: ProofHandler } | null {
    if (!this.handler) return null;
    return { protocolId: PROTOCOL_ID, handler: this.handler };
  }
  
  /**
   * Execute a tool call.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.store) {
      return this.error('Plugin not initialized. Call initialize() first.');
    }
    
    try {
      switch (name) {
        case 'anchors_commit':
          return this.commit(args);
        case 'anchors_list':
          return this.list(args);
        case 'anchors_prove':
          return this.prove(args);
        case 'anchors_verify':
          return this.verify(args);
        case 'anchors_anchor':
          return this.anchor(args);
        case 'anchors_status':
          return this.status();
        case 'anchors_request':
          return this.request(args);
        default:
          return this.error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return this.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }
  
  /**
   * Cleanup.
   */
  close(): void {
    this.store?.close();
  }
  
  // --------------------------------------------------------------------------
  // Tool Implementations
  // --------------------------------------------------------------------------
  
  private async commit(args: Record<string, unknown>): Promise<ToolResult> {
    const { type, subject, content, counterparty } = args as {
      type: CommitmentType;
      subject: string;
      content: string;
      counterparty?: string;
    };
    
    const commitment = await this.store!.commit({
      type,
      payload: { subject, content, counterparty },
    });
    
    const unanchored = await this.store!.getUnanchoredCount();
    
    return this.text(`✅ Commitment created

**ID:** \`${commitment.id}\`
**Type:** ${commitment.type}
**Subject:** ${commitment.payload.subject}
**Leaf hash:** \`${commitment.leafHash?.substring(0, 16)}...\`

${unanchored} commitment(s) pending anchor. Use \`anchors_anchor\` to broadcast.`);
  }
  
  private async list(args: Record<string, unknown>): Promise<ToolResult> {
    const { type, subject, counterparty, limit = 20 } = args as {
      type?: CommitmentType;
      subject?: string;
      counterparty?: string;
      limit?: number;
    };
    
    const commitments = await this.store!.query({
      type,
      subject,
      counterparty,
      limit,
    });
    
    if (commitments.length === 0) {
      return this.text('No commitments found matching the criteria.');
    }
    
    const lines = commitments.map(c => {
      const date = new Date(c.timestamp).toISOString().split('T')[0];
      return `- **${c.id}** (${c.type}) - ${c.payload.subject} [${date}]`;
    });
    
    return this.text(`Found ${commitments.length} commitment(s):\n\n${lines.join('\n')}`);
  }
  
  private async prove(args: Record<string, unknown>): Promise<ToolResult> {
    const { commitmentId } = args as { commitmentId: string };
    
    const proof = await this.store!.prove(commitmentId);
    
    if (!proof) {
      return this.error(`Could not generate proof for ${commitmentId}. Commitment may not exist or not be anchored yet.`);
    }
    
    return this.text(`✅ Proof generated for \`${commitmentId}\`

**Anchor TXID:** \`${proof.anchor.txid}\`
**Block:** ${proof.anchor.blockHeight ?? 'pending'}
**Root hash:** \`${proof.merkleProof.rootHash.substring(0, 16)}...\`

\`\`\`json
${JSON.stringify(proof, null, 2)}
\`\`\``);
  }
  
  private async verify(args: Record<string, unknown>): Promise<ToolResult> {
    const { proof, publicKey } = args as { 
      proof: CommitmentProof; 
      publicKey?: string;
    };
    
    let isValid: boolean;
    let level: string;
    
    if (publicKey) {
      isValid = await AnchorStore.verify(proof, publicKey);
      level = 'Full (inclusion + signature)';
    } else {
      isValid = await AnchorStore.verifyInclusion(proof);
      level = 'Inclusion only';
    }
    
    if (isValid) {
      return this.text(`✅ Proof is **VALID**

**Verification level:** ${level}
**Commitment ID:** \`${proof.commitment.id}\`
**Type:** ${proof.commitment.type}
**Subject:** ${proof.commitment.payload.subject}
**Anchor TXID:** \`${proof.anchor.txid}\``);
    } else {
      return this.text(`❌ Proof is **INVALID**

The proof failed verification at level: ${level}`);
    }
  }
  
  private async anchor(args: Record<string, unknown>): Promise<ToolResult> {
    const { dryRun = false, feeRate = 0.5 } = args as {
      dryRun?: boolean;
      feeRate?: number;
    };
    
    const unanchored = await this.store!.getUnanchoredCount();
    if (unanchored === 0) {
      return this.text('Nothing to anchor (no new commitments since last anchor).');
    }
    
    // Check wallet
    const wallet = await this.store!.checkWallet();
    if (!wallet.available) {
      const payload = await this.store!.buildAnchorPayload();
      const payloadHex = Buffer.from(payload).toString('hex');
      
      return this.text(`⚠️ Wallet not available: ${wallet.error}

**Manual anchoring required:**
1. Create OP_RETURN transaction with this payload:
\`\`\`
${payloadHex}
\`\`\`
2. Broadcast the transaction
3. Record with: \`anchors_record <txid>\``);
    }
    
    if (dryRun) {
      const payload = await this.store!.buildAnchorPayload();
      return this.text(`🔍 **Dry run** - would anchor ${unanchored} commitment(s)

**Wallet balance:** ${wallet.balance} sats
**Payload size:** ${payload.length} bytes
**Estimated fee:** ~${Math.ceil(250 * feeRate)} sats`);
    }
    
    const anchor = await this.store!.anchor({ feeRate });
    
    return this.text(`✅ Anchor broadcast successful!

**TXID:** \`${anchor.txid}\`
**Commitments anchored:** ${anchor.commitmentCount}
**Root hash:** \`${anchor.rootHash.substring(0, 16)}...\`

🔍 [View on WhatsOnChain](https://whatsonchain.com/tx/${anchor.txid})`);
  }
  
  private async status(): Promise<ToolResult> {
    const state = await this.store!.getTreeState();
    const count = await this.store!.count();
    const unanchored = await this.store!.getUnanchoredCount();
    const latestAnchor = await this.store!.getLatestAnchor();
    const publicKey = this.store!.getPublicKey();
    
    let anchorInfo = 'No anchors yet';
    if (latestAnchor) {
      const date = new Date(latestAnchor.timestamp).toISOString();
      anchorInfo = `**TXID:** \`${latestAnchor.txid.substring(0, 16)}...\`
**Block:** ${latestAnchor.blockHeight ?? 'pending'}
**Time:** ${date}`;
    }
    
    return this.text(`📊 **Anchor Store Status**

**Public key:** \`${publicKey.substring(0, 16)}...\`
**Total commitments:** ${count}
**Unanchored:** ${unanchored}
**Tree root:** \`${state.rootHash?.substring(0, 16) ?? '(empty)'}...\`

**Latest Anchor:**
${anchorInfo}`);
  }
  
  private async request(args: Record<string, unknown>): Promise<ToolResult> {
    const { peerId, commitmentId, type, counterparty } = args as {
      peerId: string;
      commitmentId?: string;
      type?: CommitmentType;
      counterparty?: string;
    };
    
    // This would integrate with bsv-p2p daemon
    // For now, return instructions
    return this.text(`🔗 P2P Proof Request

**Target peer:** \`${peerId}\`
**Query:** ${commitmentId ? `commitment ${commitmentId}` : `type=${type ?? 'all'}, counterparty=${counterparty ?? 'any'}`}

To complete this request, the bsv-p2p daemon must be running with the anchors protocol registered.

\`\`\`typescript
// In bsv-p2p daemon
import { ProofClient } from 'bsv-anchors';

const proofs = await client.queryProofs('${peerId}', {
  ${type ? `type: '${type}',` : ''}
  ${counterparty ? `counterparty: '${counterparty}',` : ''}
});
\`\`\``);
  }
  
  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  
  private text(content: string): ToolResult {
    return { content: [{ type: 'text', text: content }] };
  }
  
  private error(message: string): ToolResult {
    return { content: [{ type: 'text', text: `❌ Error: ${message}` }], isError: true };
  }
}

// ============================================================================
// OpenClaw Plugin Export Format
// ============================================================================

/**
 * Create the plugin instance for OpenClaw.
 */
export function createPlugin(config?: PluginConfig): {
  name: string;
  version: string;
  tools: ToolDefinition[];
  initialize: () => Promise<void>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  close: () => void;
} {
  const plugin = new AnchorsPlugin(config);
  
  return {
    name: 'bsv-anchors',
    version: '0.1.0',
    tools: TOOL_DEFINITIONS,
    initialize: () => plugin.initialize(),
    executeTool: (name, args) => plugin.executeTool(name, args),
    close: () => plugin.close(),
  };
}
