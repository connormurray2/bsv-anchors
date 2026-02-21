/**
 * bsv-anchors - Cryptographic Signing
 * 
 * secp256k1 signatures for commitment authentication.
 * Uses the same curve as BSV for consistency across the stack.
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Configure secp256k1 to use our HMAC-SHA256 implementation
secp.etc.hmacSha256Sync = (k: Uint8Array, ...m: Uint8Array[]): Uint8Array => {
  const h = hmac.create(sha256, k);
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ============================================================================
// Key Management
// ============================================================================

export interface KeyPair {
  privateKey: string;  // hex (32 bytes)
  publicKey: string;   // hex (33 bytes compressed)
}

/**
 * Generate a new secp256k1 key pair.
 */
export function generateKeyPair(): KeyPair {
  const privateKey = secp.utils.randomPrivateKey();
  const publicKey = secp.getPublicKey(privateKey, true); // compressed
  
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Derive public key from private key.
 */
export function getPublicKey(privateKeyHex: string): string {
  const privateKey = hexToBytes(privateKeyHex);
  const publicKey = secp.getPublicKey(privateKey, true); // compressed
  return bytesToHex(publicKey);
}

// ============================================================================
// Signing & Verification
// ============================================================================

/**
 * Hash message for signing (double SHA256 like BSV).
 */
function hashMessage(message: string | Uint8Array): Uint8Array {
  const messageBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
  return sha256(sha256(messageBytes));
}

/**
 * Sign a message with secp256k1.
 * Returns compact signature (64 bytes) as hex.
 */
export function sign(message: string | Uint8Array, privateKeyHex: string): string {
  const msgHash = hashMessage(message);
  const privateKey = hexToBytes(privateKeyHex);
  const signature = secp.sign(msgHash, privateKey);
  return signature.toCompactHex();
}

/**
 * Verify a secp256k1 signature.
 */
export function verify(
  message: string | Uint8Array, 
  signatureHex: string, 
  publicKeyHex: string
): boolean {
  try {
    const msgHash = hashMessage(message);
    const signature = secp.Signature.fromCompact(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    return secp.verify(signature, msgHash, publicKey);
  } catch {
    return false;
  }
}

// ============================================================================
// Key Storage
// ============================================================================

const KEY_FILE = 'identity-key.json';

export interface StoredKey {
  privateKey: string;
  publicKey: string;
  createdAt: string;
  keyType: 'secp256k1';
}

/**
 * Load or create identity key from data directory.
 */
export function loadOrCreateKey(dataDir: string): KeyPair {
  const keyPath = join(dataDir, KEY_FILE);
  
  if (existsSync(keyPath)) {
    const stored = JSON.parse(readFileSync(keyPath, 'utf-8')) as StoredKey;
    return {
      privateKey: stored.privateKey,
      publicKey: stored.publicKey,
    };
  }
  
  // Create new key
  const keyPair = generateKeyPair();
  
  // Ensure directory exists
  mkdirSync(dirname(keyPath), { recursive: true });
  
  // Save key
  const stored: StoredKey = {
    ...keyPair,
    createdAt: new Date().toISOString(),
    keyType: 'secp256k1',
  };
  writeFileSync(keyPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  
  return keyPair;
}

/**
 * Check if identity key exists.
 */
export function keyExists(dataDir: string): boolean {
  return existsSync(join(dataDir, KEY_FILE));
}
