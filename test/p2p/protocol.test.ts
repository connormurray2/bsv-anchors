/**
 * P2P Protocol Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnchorStore } from '../../src/store/anchor-store.js';
import { ProofHandler } from '../../src/p2p/handler.js';
import {
  PROTOCOL_ID,
  encodeMessage,
  decodeMessage,
  createProofRequest,
  createProofResponse,
  createProofPush,
  createProofAck,
  createProofError,
  validateRequest,
  type ProofRequest,
  type ProofResponse,
} from '../../src/p2p/protocol.js';

describe('P2P Protocol', () => {
  describe('message encoding/decoding', () => {
    it('should round-trip proof request', () => {
      const request = createProofRequest({
        commitmentId: 'commit_abc123',
        options: { requireAnchored: true },
      });
      
      const encoded = encodeMessage(request);
      const decoded = decodeMessage(encoded);
      
      expect(decoded.type).toBe('PROOF_REQUEST');
      expect((decoded as ProofRequest).commitmentId).toBe('commit_abc123');
    });
    
    it('should round-trip proof response', () => {
      const response = createProofResponse('req_123', [], {
        publicKey: 'abc123',
        total: 0,
      });
      
      const encoded = encodeMessage(response);
      const decoded = decodeMessage(encoded);
      
      expect(decoded.type).toBe('PROOF_RESPONSE');
      expect((decoded as ProofResponse).requestId).toBe('req_123');
    });
    
    it('should round-trip proof push', () => {
      const mockProof = {
        commitment: {
          id: 'commit_123',
          type: 'agreement' as const,
          payload: { subject: 'test', content: 'test' },
          signature: 'sig',
          timestamp: Date.now(),
        },
        merkleProof: {
          leafHash: 'hash',
          leafIndex: 0,
          siblings: [],
          rootHash: 'root',
        },
        anchor: {
          txid: 'txid',
          timestamp: Date.now(),
        },
      };
      
      const push = createProofPush(mockProof, 'pubkey123', 'bilateral');
      
      const encoded = encodeMessage(push);
      const decoded = decodeMessage(encoded);
      
      expect(decoded.type).toBe('PROOF_PUSH');
    });
    
    it('should round-trip proof ack', () => {
      const ack = createProofAck('push_123', true, { verified: true });
      
      const encoded = encodeMessage(ack);
      const decoded = decodeMessage(encoded);
      
      expect(decoded.type).toBe('PROOF_ACK');
    });
    
    it('should round-trip proof error', () => {
      const error = createProofError('NOT_FOUND', 'Commitment not found', {
        requestId: 'req_123',
      });
      
      const encoded = encodeMessage(error);
      const decoded = decodeMessage(encoded);
      
      expect(decoded.type).toBe('PROOF_ERROR');
    });
    
    it('should reject invalid message type', () => {
      const invalid = { type: 'INVALID_TYPE' };
      const encoded = new TextEncoder().encode(JSON.stringify(invalid));
      
      expect(() => decodeMessage(encoded)).toThrow('Invalid message type');
    });
  });
  
  describe('request validation', () => {
    it('should require commitmentId or query', () => {
      const request: ProofRequest = {
        type: 'PROOF_REQUEST',
        requestId: 'req_123',
      };
      
      const result = validateRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Must specify');
    });
    
    it('should accept commitmentId', () => {
      const request = createProofRequest({ commitmentId: 'commit_123' });
      const result = validateRequest(request);
      expect(result.valid).toBe(true);
    });
    
    it('should accept query', () => {
      const request = createProofRequest({ query: { type: 'agreement' } });
      const result = validateRequest(request);
      expect(result.valid).toBe(true);
    });
    
    it('should reject query with limit > 100', () => {
      const request = createProofRequest({ query: { limit: 200 } });
      const result = validateRequest(request);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('limit');
    });
  });
});

describe('ProofHandler', () => {
  let store: AnchorStore;
  let handler: ProofHandler;
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bsv-anchors-p2p-test-'));
    store = await AnchorStore.open(tempDir);
    handler = new ProofHandler({ store });
  });
  
  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  
  describe('handleMessage', () => {
    it('should handle proof request for non-existent commitment', async () => {
      const request = createProofRequest({ commitmentId: 'nonexistent' });
      const response = await handler.handleMessage(
        encodeMessage(request),
        'peer123'
      );
      
      expect(response).not.toBeNull();
      const decoded = decodeMessage(response!) as ProofResponse;
      expect(decoded.type).toBe('PROOF_RESPONSE');
      expect(decoded.proofs).toHaveLength(0);
    });
    
    it('should handle proof request for existing commitment', async () => {
      // Create and anchor a commitment
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test content' },
      });
      await store.recordAnchor('test_txid');
      
      const request = createProofRequest({ commitmentId: commitment.id });
      const response = await handler.handleMessage(
        encodeMessage(request),
        'peer123'
      );
      
      expect(response).not.toBeNull();
      const decoded = decodeMessage(response!) as ProofResponse;
      expect(decoded.type).toBe('PROOF_RESPONSE');
      expect(decoded.proofs).toHaveLength(1);
      expect(decoded.proofs[0].commitment.id).toBe(commitment.id);
    });
    
    it('should handle query request', async () => {
      // Create multiple commitments
      await store.commit({
        type: 'agreement',
        payload: { subject: 'code-review', content: 'Review 1' },
      });
      await store.commit({
        type: 'agreement',
        payload: { subject: 'code-review', content: 'Review 2' },
      });
      await store.commit({
        type: 'attestation',
        payload: { subject: 'identity', content: 'I am peer X' },
      });
      await store.recordAnchor('test_txid');
      
      const request = createProofRequest({
        query: { type: 'agreement' },
      });
      const response = await handler.handleMessage(
        encodeMessage(request),
        'peer123'
      );
      
      const decoded = decodeMessage(response!) as ProofResponse;
      expect(decoded.proofs).toHaveLength(2);
    });
    
    it('should include public key when requested', async () => {
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      await store.recordAnchor('test_txid');
      
      const request = createProofRequest({
        query: { type: 'agreement' },
        options: { includePublicKey: true },
      });
      const response = await handler.handleMessage(
        encodeMessage(request),
        'peer123'
      );
      
      const decoded = decodeMessage(response!) as ProofResponse;
      expect(decoded.publicKey).toBeDefined();
      expect(decoded.publicKey).toMatch(/^[0-9a-f]{64}$/);
    });
    
    it('should rate limit requests', async () => {
      // Create handler with low rate limit
      const limitedHandler = new ProofHandler({
        store,
        rateLimitPerMinute: 2,
      });
      
      const request = createProofRequest({ query: { type: 'agreement' } });
      const encoded = encodeMessage(request);
      
      // First two should succeed
      await limitedHandler.handleMessage(encoded, 'peer123');
      await limitedHandler.handleMessage(encoded, 'peer123');
      
      // Third should be rate limited
      const response = await limitedHandler.handleMessage(encoded, 'peer123');
      const decoded = decodeMessage(response!);
      
      expect(decoded.type).toBe('PROOF_ERROR');
    });
    
    it('should handle invalid request', async () => {
      const request: ProofRequest = {
        type: 'PROOF_REQUEST',
        requestId: 'req_123',
        // Missing commitmentId and query
      };
      
      const response = await handler.handleMessage(
        encodeMessage(request),
        'peer123'
      );
      
      const decoded = decodeMessage(response!);
      expect(decoded.type).toBe('PROOF_ERROR');
    });
  });
  
  describe('createRequest', () => {
    it('should create request with unique ID', () => {
      const { message, requestId } = handler.createRequest({
        commitmentId: 'commit_123',
      });
      
      expect(requestId).toMatch(/^req_/);
      expect(message).toBeInstanceOf(Uint8Array);
    });
  });
});

describe('Protocol constants', () => {
  it('should have correct protocol ID', () => {
    expect(PROTOCOL_ID).toBe('/bsv-anchors/proof/1.0.0');
  });
});
