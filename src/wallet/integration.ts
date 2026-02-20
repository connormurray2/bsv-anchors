/**
 * bsv-anchors - Wallet Integration
 * 
 * Integration with bsv-wallet for broadcasting anchor transactions.
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface WalletStatus {
  available: boolean;
  balance?: number;
  address?: string;
  error?: string;
}

export interface BroadcastResult {
  success: boolean;
  txid?: string;
  error?: string;
}

export interface AnchorTxOptions {
  /** OP_RETURN payload (from buildAnchorPayload) */
  payload: Uint8Array;
  
  /** Fee rate in sats/byte (default: 0.5) */
  feeRate?: number;
  
  /** Dry run - don't actually broadcast */
  dryRun?: boolean;
}

// ============================================================================
// Wallet Detection
// ============================================================================

/**
 * Check if bsv-wallet CLI is available.
 */
export async function checkWallet(): Promise<WalletStatus> {
  try {
    // Try to get balance
    const { stdout } = await execAsync('bsv-wallet balance --json 2>/dev/null');
    const result = JSON.parse(stdout.trim());
    
    return {
      available: true,
      balance: result.balance ?? result.confirmed ?? 0,
      address: result.address,
    };
  } catch (error) {
    // Try just checking if command exists
    try {
      await execAsync('which bsv-wallet');
      return {
        available: true,
        error: 'Wallet not initialized. Run: bsv-wallet init',
      };
    } catch {
      return {
        available: false,
        error: 'bsv-wallet not found. Install: npm install -g bsv-wallet',
      };
    }
  }
}

/**
 * Check wallet balance.
 */
export async function getBalance(): Promise<number> {
  try {
    const { stdout } = await execAsync('bsv-wallet balance --json');
    const result = JSON.parse(stdout.trim());
    return result.balance ?? result.confirmed ?? 0;
  } catch (error) {
    throw new Error('Failed to get wallet balance. Is bsv-wallet initialized?');
  }
}

/**
 * Get wallet address.
 */
export async function getAddress(): Promise<string> {
  try {
    const { stdout } = await execAsync('bsv-wallet address');
    return stdout.trim();
  } catch (error) {
    throw new Error('Failed to get wallet address. Is bsv-wallet initialized?');
  }
}

// ============================================================================
// Transaction Building & Broadcasting
// ============================================================================

/**
 * Build and broadcast an anchor transaction.
 * 
 * Creates a transaction with:
 * - Input: UTXO from wallet
 * - Output 1: OP_RETURN with anchor payload
 * - Output 2: Change back to wallet
 */
export async function broadcastAnchor(options: AnchorTxOptions): Promise<BroadcastResult> {
  const { payload, feeRate = 0.5, dryRun = false } = options;
  
  // Convert payload to hex
  const payloadHex = Buffer.from(payload).toString('hex');
  
  // Check wallet status
  const status = await checkWallet();
  if (!status.available) {
    return { success: false, error: status.error };
  }
  
  // Estimate fee (OP_RETURN tx is ~250 bytes)
  const estimatedSize = 250;
  const estimatedFee = Math.ceil(estimatedSize * feeRate);
  
  // Check balance
  const balance = status.balance ?? 0;
  if (balance < estimatedFee + 1) {
    return { 
      success: false, 
      error: `Insufficient balance: ${balance} sats (need ~${estimatedFee + 1} sats)` 
    };
  }
  
  if (dryRun) {
    return {
      success: true,
      txid: `DRY_RUN_${Date.now().toString(16)}`,
    };
  }
  
  try {
    // Use bsv-wallet to broadcast OP_RETURN transaction
    // The command format depends on bsv-wallet implementation
    const { stdout } = await execAsync(
      `bsv-wallet op-return "${payloadHex}" --fee-rate ${feeRate} --json`
    );
    
    const result = JSON.parse(stdout.trim());
    
    if (result.txid) {
      return { success: true, txid: result.txid };
    } else {
      return { success: false, error: result.error ?? 'Unknown error' };
    }
  } catch (error) {
    // Fallback: try alternative command format
    try {
      const { stdout } = await execAsync(
        `bsv-wallet send --op-return "${payloadHex}" --json`
      );
      
      const result = JSON.parse(stdout.trim());
      return { success: true, txid: result.txid };
    } catch (fallbackError) {
      return { 
        success: false, 
        error: `Broadcast failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }
}

// ============================================================================
// WhatsOnChain Integration
// ============================================================================

const WOC_API = 'https://api.whatsonchain.com/v1/bsv/main';

/**
 * Verify an anchor transaction exists on-chain.
 */
export async function verifyAnchorOnChain(txid: string): Promise<{
  confirmed: boolean;
  blockHeight?: number;
  blockTime?: number;
  error?: string;
}> {
  try {
    const response = await fetch(`${WOC_API}/tx/${txid}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { confirmed: false, error: 'Transaction not found' };
      }
      return { confirmed: false, error: `API error: ${response.status}` };
    }
    
    const tx = await response.json() as {
      blockheight?: number;
      blocktime?: number;
      confirmations?: number;
    };
    
    if (tx.blockheight && tx.blockheight > 0) {
      return {
        confirmed: true,
        blockHeight: tx.blockheight,
        blockTime: tx.blocktime,
      };
    }
    
    // Unconfirmed but in mempool
    return { confirmed: false };
  } catch (error) {
    return { 
      confirmed: false, 
      error: `Failed to verify: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Get OP_RETURN data from a transaction.
 */
export async function getAnchorData(txid: string): Promise<{
  found: boolean;
  payload?: Uint8Array;
  payloadHex?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${WOC_API}/tx/${txid}/hex`);
    
    if (!response.ok) {
      return { found: false, error: `API error: ${response.status}` };
    }
    
    const txHex = await response.text();
    
    // Parse OP_RETURN from raw tx (simplified - looks for OP_FALSE OP_RETURN pattern)
    // In production, use a proper BSV tx parser
    const opReturnMarker = '006a'; // OP_FALSE OP_RETURN
    const markerIndex = txHex.indexOf(opReturnMarker);
    
    if (markerIndex === -1) {
      return { found: false, error: 'No OP_RETURN found in transaction' };
    }
    
    // Extract data after OP_RETURN (simplified parsing)
    // Format: 006a <pushdata> <data>
    const afterMarker = txHex.substring(markerIndex + 4);
    
    // Get push length (assuming <0x4c for simplicity)
    const pushLen = parseInt(afterMarker.substring(0, 2), 16);
    const dataHex = afterMarker.substring(2, 2 + pushLen * 2);
    
    const payload = Buffer.from(dataHex, 'hex');
    
    // Verify it's a BSV-ANCHOR payload
    const protocol = payload.slice(0, 10).toString('utf-8');
    if (protocol !== 'BSV-ANCHOR') {
      return { found: false, error: 'Not a BSV-ANCHOR transaction' };
    }
    
    return {
      found: true,
      payload: new Uint8Array(payload),
      payloadHex: dataHex,
    };
  } catch (error) {
    return { 
      found: false, 
      error: `Failed to get anchor data: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Parse anchor payload to extract root hash and metadata.
 */
export function parseAnchorPayload(payload: Uint8Array): {
  valid: boolean;
  version?: number;
  rootHash?: string;
  commitmentCount?: number;
  previousAnchor?: string;
  error?: string;
} {
  try {
    // Protocol: "BSV-ANCHOR" (10) + version (1) + root (32) + count (4) + prev (32) = 79 bytes
    if (payload.length !== 79) {
      return { valid: false, error: `Invalid payload length: ${payload.length} (expected 79)` };
    }
    
    const protocol = new TextDecoder().decode(payload.slice(0, 10));
    if (protocol !== 'BSV-ANCHOR') {
      return { valid: false, error: 'Invalid protocol identifier' };
    }
    
    const version = payload[10];
    if (version !== 0x01) {
      return { valid: false, error: `Unsupported version: ${version}` };
    }
    
    const rootHash = Buffer.from(payload.slice(11, 43)).toString('hex');
    const commitmentCount = new DataView(payload.buffer, payload.byteOffset + 43, 4).getUint32(0, false);
    const prevBytes = payload.slice(47, 79);
    const previousAnchor = prevBytes.every(b => b === 0) 
      ? undefined 
      : Buffer.from(prevBytes).toString('hex');
    
    return {
      valid: true,
      version,
      rootHash,
      commitmentCount,
      previousAnchor,
    };
  } catch (error) {
    return { 
      valid: false, 
      error: `Parse error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}
