/**
 * bsv-anchors - Cryptographic Signing
 * 
 * Ed25519 signatures for commitment authentication.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Configure ed25519 to use sha512
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ============================================================================
// Key Management
// ============================================================================

export interface KeyPair {
  privateKey: string;  // hex
  publicKey: string;   // hex
}

/**
 * Generate a new Ed25519 key pair.
 */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = ed.getPublicKey(privateKey);
  
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
  const publicKey = ed.getPublicKey(privateKey);
  return bytesToHex(publicKey);
}

// ============================================================================
// Signing & Verification
// ============================================================================

/**
 * Sign a message with Ed25519.
 */
export function sign(message: string | Uint8Array, privateKeyHex: string): string {
  const messageBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
  const privateKey = hexToBytes(privateKeyHex);
  const signature = ed.sign(messageBytes, privateKey);
  return bytesToHex(signature);
}

/**
 * Verify an Ed25519 signature.
 */
export function verify(
  message: string | Uint8Array, 
  signatureHex: string, 
  publicKeyHex: string
): boolean {
  try {
    const messageBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    return ed.verify(signature, messageBytes, publicKey);
  } catch {
    return false;
  }
}

// ============================================================================
// Key Storage
// ============================================================================

const KEY_FILE = 'signing-key.json';

export interface StoredKey {
  privateKey: string;
  publicKey: string;
  createdAt: string;
}

/**
 * Load or create signing key from data directory.
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
  };
  writeFileSync(keyPath, JSON.stringify(stored, null, 2), { mode: 0o600 });
  
  return keyPair;
}

/**
 * Check if signing key exists.
 */
export function keyExists(dataDir: string): boolean {
  return existsSync(join(dataDir, KEY_FILE));
}
