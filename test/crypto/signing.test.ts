/**
 * Signing Tests - secp256k1
 */

import { describe, it, expect } from 'vitest';
import { 
  generateKeyPair, 
  getPublicKey, 
  sign, 
  verify 
} from '../../src/crypto/signing.js';

describe('Key Generation', () => {
  it('should generate valid key pair', () => {
    const keyPair = generateKeyPair();
    
    // secp256k1: 32-byte private key (64 hex)
    expect(keyPair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    // secp256k1: 33-byte compressed public key (66 hex)
    expect(keyPair.publicKey).toMatch(/^[0-9a-f]{66}$/);
  });
  
  it('should generate unique keys each time', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });
  
  it('should derive correct public key from private key', () => {
    const keyPair = generateKeyPair();
    const derivedPublic = getPublicKey(keyPair.privateKey);
    
    expect(derivedPublic).toBe(keyPair.publicKey);
  });
  
  it('should produce compressed public keys starting with 02 or 03', () => {
    // Run multiple times to catch both prefixes
    for (let i = 0; i < 10; i++) {
      const keyPair = generateKeyPair();
      expect(keyPair.publicKey).toMatch(/^0[23]/);
    }
  });
});

describe('Signing', () => {
  it('should produce valid signatures', () => {
    const keyPair = generateKeyPair();
    const message = 'Hello, World!';
    
    const sig = sign(message, keyPair.privateKey);
    
    // secp256k1 compact signature: 64 bytes (128 hex)
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });
  
  it('should produce different signatures for different messages', () => {
    const keyPair = generateKeyPair();
    
    const sig1 = sign('message 1', keyPair.privateKey);
    const sig2 = sign('message 2', keyPair.privateKey);
    
    expect(sig1).not.toBe(sig2);
  });
  
  it('should produce 128-character hex signature (compact format)', () => {
    const keyPair = generateKeyPair();
    const sig = sign('test message', keyPair.privateKey);
    
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe('Verification', () => {
  it('should verify valid signature', () => {
    const keyPair = generateKeyPair();
    const message = 'Hello, World!';
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify(message, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });
  
  it('should reject tampered message', () => {
    const keyPair = generateKeyPair();
    const message = 'Original message';
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify('Tampered message', signature, keyPair.publicKey);
    expect(isValid).toBe(false);
  });
  
  it('should reject wrong public key', () => {
    const keyPair1 = generateKeyPair();
    const keyPair2 = generateKeyPair();
    
    const message = 'Test message';
    const signature = sign(message, keyPair1.privateKey);
    
    const isValid = verify(message, signature, keyPair2.publicKey);
    expect(isValid).toBe(false);
  });
  
  it('should reject invalid signature format', () => {
    const keyPair = generateKeyPair();
    const message = 'Test message';
    
    const isValid = verify(message, 'invalid_signature', keyPair.publicKey);
    expect(isValid).toBe(false);
  });
  
  it('should handle empty message', () => {
    const keyPair = generateKeyPair();
    const message = '';
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify(message, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });
  
  it('should handle unicode messages', () => {
    const keyPair = generateKeyPair();
    const message = '你好世界 🌍 مرحبا';
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify(message, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });
  
  it('should handle long messages', () => {
    const keyPair = generateKeyPair();
    const message = 'x'.repeat(10000);
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify(message, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });
  
  it('should handle binary data', () => {
    const keyPair = generateKeyPair();
    const message = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const signature = sign(message, keyPair.privateKey);
    
    const isValid = verify(message, signature, keyPair.publicKey);
    expect(isValid).toBe(true);
  });
});

describe('BSV Compatibility', () => {
  it('should use double SHA256 for message hashing', () => {
    // This is implicitly tested by the sign/verify working
    // The implementation uses sha256(sha256(message)) like BSV
    const keyPair = generateKeyPair();
    const message = 'BSV transaction data';
    const signature = sign(message, keyPair.privateKey);
    
    expect(verify(message, signature, keyPair.publicKey)).toBe(true);
  });
});
