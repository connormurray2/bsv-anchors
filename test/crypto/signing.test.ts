/**
 * Signing Tests
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
    
    expect(keyPair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPair.publicKey).toMatch(/^[0-9a-f]{64}$/);
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
});

describe('Signing', () => {
  it('should produce consistent signatures', () => {
    const keyPair = generateKeyPair();
    const message = 'Hello, World!';
    
    const sig1 = sign(message, keyPair.privateKey);
    const sig2 = sign(message, keyPair.privateKey);
    
    // Ed25519 signatures are deterministic
    expect(sig1).toBe(sig2);
  });
  
  it('should produce different signatures for different messages', () => {
    const keyPair = generateKeyPair();
    
    const sig1 = sign('message 1', keyPair.privateKey);
    const sig2 = sign('message 2', keyPair.privateKey);
    
    expect(sig1).not.toBe(sig2);
  });
  
  it('should produce 128-character hex signature', () => {
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
});
