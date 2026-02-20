#!/usr/bin/env node
/**
 * bsv-anchors CLI
 * 
 * Command-line interface for commitment management.
 */

import { Command } from 'commander';
import { AnchorStore } from '../store/anchor-store.js';
import type { CommitmentType, CommitmentQuery } from '../types.js';

const program = new Command();

program
  .name('bsv-anchors')
  .description('Verifiable agent memory - anchor commitments to BSV')
  .version('0.1.0');

// ============================================================================
// Init Command
// ============================================================================

program
  .command('init')
  .description('Initialize a new anchor store')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      const publicKey = store.getPublicKey();
      
      console.log('✅ Anchor store initialized');
      console.log(`📁 Data directory: ${store.getDataDir()}`);
      console.log(`🔑 Public key: ${publicKey}`);
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to initialize:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Commit Command
// ============================================================================

program
  .command('commit')
  .description('Create a new commitment')
  .requiredOption('-t, --type <type>', 'Commitment type (agreement|attestation|state|custom)')
  .requiredOption('-s, --subject <subject>', 'Subject of the commitment')
  .requiredOption('-c, --content <content>', 'Content of the commitment')
  .option('-p, --counterparty <id>', 'Counterparty peer ID or address')
  .option('-m, --metadata <json>', 'Additional metadata as JSON')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const validTypes: CommitmentType[] = ['agreement', 'attestation', 'state', 'custom'];
      if (!validTypes.includes(options.type)) {
        console.error(`❌ Invalid type. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }
      
      const commitment = await store.commit({
        type: options.type as CommitmentType,
        payload: {
          subject: options.subject,
          content: options.content,
          counterparty: options.counterparty,
          metadata: options.metadata ? JSON.parse(options.metadata) : undefined,
        },
      });
      
      console.log('✅ Commitment created');
      console.log(`   ID: ${commitment.id}`);
      console.log(`   Type: ${commitment.type}`);
      console.log(`   Subject: ${commitment.payload.subject}`);
      console.log(`   Leaf hash: ${commitment.leafHash}`);
      console.log(`   Tree index: ${commitment.treeIndex}`);
      
      const unanchored = await store.getUnanchoredCount();
      if (unanchored > 0) {
        console.log(`\n💡 ${unanchored} commitment(s) pending anchor. Run 'bsv-anchors anchor' to anchor.`);
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to create commitment:', error);
      process.exit(1);
    }
  });

// ============================================================================
// List Command
// ============================================================================

program
  .command('list')
  .description('List commitments')
  .option('-t, --type <type>', 'Filter by type')
  .option('-s, --subject <subject>', 'Filter by subject (substring)')
  .option('-p, --counterparty <id>', 'Filter by counterparty')
  .option('-n, --limit <number>', 'Maximum results', '20')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const query: CommitmentQuery = {
        type: options.type as CommitmentType,
        subject: options.subject,
        counterparty: options.counterparty,
        limit: parseInt(options.limit, 10),
      };
      
      const commitments = await store.query(query);
      
      if (commitments.length === 0) {
        console.log('No commitments found.');
      } else {
        console.log(`Found ${commitments.length} commitment(s):\n`);
        
        for (const c of commitments) {
          const date = new Date(c.timestamp).toISOString();
          console.log(`📋 ${c.id}`);
          console.log(`   Type: ${c.type}`);
          console.log(`   Subject: ${c.payload.subject}`);
          console.log(`   Content: ${c.payload.content.substring(0, 60)}${c.payload.content.length > 60 ? '...' : ''}`);
          if (c.payload.counterparty) {
            console.log(`   Counterparty: ${c.payload.counterparty}`);
          }
          console.log(`   Created: ${date}`);
          console.log('');
        }
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to list commitments:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Status Command
// ============================================================================

program
  .command('status')
  .description('Show store status')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const state = await store.getTreeState();
      const commitmentCount = await store.count();
      const unanchored = await store.getUnanchoredCount();
      const latestAnchor = await store.getLatestAnchor();
      const publicKey = store.getPublicKey();
      
      console.log('📊 Anchor Store Status\n');
      console.log(`📁 Data directory: ${store.getDataDir()}`);
      console.log(`🔑 Public key: ${publicKey.substring(0, 16)}...`);
      console.log('');
      console.log(`📋 Total commitments: ${commitmentCount}`);
      console.log(`⏳ Unanchored: ${unanchored}`);
      console.log(`🌳 Tree root: ${state.rootHash ? state.rootHash.substring(0, 16) + '...' : '(empty)'}`);
      console.log('');
      
      if (latestAnchor) {
        const date = new Date(latestAnchor.timestamp).toISOString();
        console.log(`⚓ Latest anchor:`);
        console.log(`   TXID: ${latestAnchor.txid}`);
        console.log(`   Block: ${latestAnchor.blockHeight ?? 'pending'}`);
        console.log(`   Time: ${date}`);
        console.log(`   Commitments: ${latestAnchor.commitmentCount}`);
      } else {
        console.log('⚓ No anchors yet');
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to get status:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Prove Command
// ============================================================================

program
  .command('prove <commitment-id>')
  .description('Generate a Merkle proof for a commitment')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (commitmentId, options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const proof = await store.prove(commitmentId);
      
      if (!proof) {
        console.error('❌ Could not generate proof.');
        console.error('   - Commitment may not exist');
        console.error('   - Commitment may not be anchored yet');
        process.exit(1);
      }
      
      const proofJson = JSON.stringify(proof, null, 2);
      
      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.output, proofJson);
        console.log(`✅ Proof written to ${options.output}`);
      } else {
        console.log(proofJson);
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to generate proof:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Verify Command
// ============================================================================

program
  .command('verify <proof-file>')
  .description('Verify a commitment proof')
  .option('-k, --public-key <hex>', 'Public key to verify signature (optional)')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (proofFile, options) => {
    try {
      const { readFileSync } = await import('fs');
      const proofJson = readFileSync(proofFile, 'utf-8');
      const proof = JSON.parse(proofJson);
      
      let isValid: boolean;
      let verificationLevel: string;
      
      if (options.publicKey) {
        // Full verification with signature
        isValid = await AnchorStore.verify(proof, options.publicKey);
        verificationLevel = 'Full (inclusion + signature)';
      } else {
        // Inclusion-only verification
        isValid = await AnchorStore.verifyInclusion(proof);
        verificationLevel = 'Inclusion only (signature not verified)';
      }
      
      if (isValid) {
        console.log('✅ Proof is VALID');
        console.log(`   Verification: ${verificationLevel}`);
        console.log('');
        console.log('📋 Commitment:');
        console.log(`   ID: ${proof.commitment.id}`);
        console.log(`   Type: ${proof.commitment.type}`);
        console.log(`   Subject: ${proof.commitment.payload.subject}`);
        console.log('');
        console.log('⚓ Anchor:');
        console.log(`   TXID: ${proof.anchor.txid}`);
        console.log(`   Block: ${proof.anchor.blockHeight ?? 'pending'}`);
        console.log(`   Time: ${new Date(proof.anchor.timestamp).toISOString()}`);
        
        if (!options.publicKey) {
          console.log('\n💡 Tip: Use --public-key <hex> for full signature verification');
        }
      } else {
        console.log('❌ Proof is INVALID');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Failed to verify proof:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Anchors Command
// ============================================================================

program
  .command('anchors')
  .description('List all anchors')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const anchors = await store.listAnchors();
      
      if (anchors.length === 0) {
        console.log('No anchors yet.');
      } else {
        console.log(`Found ${anchors.length} anchor(s):\n`);
        
        for (const a of anchors) {
          const date = new Date(a.timestamp).toISOString();
          console.log(`⚓ Anchor #${a.anchorIndex}`);
          console.log(`   TXID: ${a.txid}`);
          console.log(`   Block: ${a.blockHeight ?? 'pending'}`);
          console.log(`   Root: ${a.rootHash.substring(0, 16)}...`);
          console.log(`   Commitments: ${a.commitmentCount}`);
          console.log(`   Time: ${date}`);
          if (a.previousAnchor) {
            console.log(`   Previous: ${a.previousAnchor.substring(0, 16)}...`);
          }
          console.log('');
        }
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to list anchors:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Anchor Command (manual - requires wallet integration for real use)
// ============================================================================

program
  .command('anchor')
  .description('Anchor current tree to BSV blockchain')
  .option('--dry-run', 'Show payload without broadcasting')
  .option('--manual', 'Manual mode: show payload only, don\'t use wallet')
  .option('-f, --fee-rate <sats>', 'Fee rate in sats/byte', '0.5')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const unanchored = await store.getUnanchoredCount();
      if (unanchored === 0) {
        console.log('Nothing to anchor (no new commitments since last anchor).');
        store.close();
        return;
      }
      
      const payload = await store.buildAnchorPayload();
      const payloadHex = Buffer.from(payload).toString('hex');
      
      console.log('🔗 Anchor Transaction\n');
      console.log(`Commitments to anchor: ${unanchored}`);
      console.log(`Payload size: ${payload.length} bytes`);
      
      if (options.manual) {
        // Manual mode - just show payload
        console.log('');
        console.log('OP_RETURN data (hex):');
        console.log(payloadHex);
        console.log('');
        console.log('⚠️  Manual mode. To complete anchoring:');
        console.log('1. Create a BSV transaction with this OP_RETURN output');
        console.log('2. Broadcast the transaction');
        console.log('3. Run: bsv-anchors record-anchor <txid>');
        store.close();
        return;
      }
      
      // Check wallet
      const wallet = await store.checkWallet();
      if (!wallet.available) {
        console.log('');
        console.log(`❌ Wallet not available: ${wallet.error}`);
        console.log('');
        console.log('Options:');
        console.log('  1. Install bsv-wallet: npm install -g bsv-wallet');
        console.log('  2. Initialize wallet: bsv-wallet init');
        console.log('  3. Use --manual flag to broadcast manually');
        store.close();
        process.exit(1);
      }
      
      console.log(`💰 Wallet balance: ${wallet.balance} sats`);
      console.log(`📍 Address: ${wallet.address}`);
      console.log('');
      
      if (options.dryRun) {
        console.log('(Dry run - transaction not broadcast)');
        console.log('');
        console.log('OP_RETURN payload (hex):');
        console.log(payloadHex);
        store.close();
        return;
      }
      
      // Broadcast
      console.log('Broadcasting...');
      const anchor = await store.anchor({ 
        feeRate: parseFloat(options.feeRate),
        dryRun: false 
      });
      
      console.log('');
      console.log('✅ Anchor broadcast successful!');
      console.log(`   TXID: ${anchor.txid}`);
      console.log(`   Index: ${anchor.anchorIndex}`);
      console.log(`   Commitments: ${anchor.commitmentCount}`);
      console.log(`   Root: ${anchor.rootHash.substring(0, 16)}...`);
      console.log('');
      console.log(`🔍 View on WhatsOnChain: https://whatsonchain.com/tx/${anchor.txid}`);
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to anchor:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Record Anchor Command
// ============================================================================

program
  .command('record-anchor <txid>')
  .description('Record an anchor after broadcasting')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (txid, options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      const anchor = await store.recordAnchor(txid);
      
      console.log('✅ Anchor recorded');
      console.log(`   Index: ${anchor.anchorIndex}`);
      console.log(`   TXID: ${anchor.txid}`);
      console.log(`   Root: ${anchor.rootHash}`);
      console.log(`   Commitments: ${anchor.commitmentCount}`);
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to record anchor:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Refresh Command
// ============================================================================

program
  .command('refresh [txid]')
  .description('Refresh anchor confirmation status from blockchain')
  .option('-d, --data-dir <path>', 'Data directory path', '~/.bsv-anchors')
  .action(async (txid, options) => {
    try {
      const store = await AnchorStore.open(options.dataDir);
      
      if (txid) {
        // Refresh specific anchor
        const anchor = await store.refreshAnchor(txid);
        
        if (!anchor) {
          console.log(`❌ Anchor not found: ${txid}`);
          store.close();
          process.exit(1);
        }
        
        console.log(`⚓ Anchor #${anchor.anchorIndex}`);
        console.log(`   TXID: ${anchor.txid}`);
        console.log(`   Block: ${anchor.blockHeight ?? 'pending (unconfirmed)'}`);
        console.log(`   Root: ${anchor.rootHash.substring(0, 16)}...`);
      } else {
        // Refresh all anchors
        const anchors = await store.listAnchors();
        let updated = 0;
        
        for (const a of anchors) {
          if (!a.blockHeight) {
            const refreshed = await store.refreshAnchor(a.txid);
            if (refreshed?.blockHeight) {
              console.log(`✅ Anchor #${a.anchorIndex} confirmed at block ${refreshed.blockHeight}`);
              updated++;
            }
          }
        }
        
        if (updated === 0) {
          console.log('All anchors already confirmed (or none pending).');
        } else {
          console.log(`\n${updated} anchor(s) updated.`);
        }
      }
      
      store.close();
    } catch (error) {
      console.error('❌ Failed to refresh:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Wallet Command
// ============================================================================

program
  .command('wallet')
  .description('Check wallet status')
  .action(async () => {
    try {
      const { checkWallet, getBalance, getAddress } = await import('../wallet/integration.js');
      
      const status = await checkWallet();
      
      if (!status.available) {
        console.log('❌ Wallet not available');
        console.log(`   ${status.error}`);
        console.log('');
        console.log('To install:');
        console.log('   npm install -g bsv-wallet');
        console.log('   bsv-wallet init');
        process.exit(1);
      }
      
      console.log('💰 Wallet Status\n');
      console.log(`   Balance: ${status.balance} sats`);
      console.log(`   Address: ${status.address}`);
      console.log('');
      console.log('Ready to anchor!');
    } catch (error) {
      console.error('❌ Failed to check wallet:', error);
      process.exit(1);
    }
  });

// ============================================================================
// Run CLI
// ============================================================================

program.parse();
