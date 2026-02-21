/**
 * Anchor Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnchorStore } from '../../src/store/anchor-store.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AnchorStore', () => {
  let store: AnchorStore;
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bsv-anchors-test-'));
    store = await AnchorStore.open(tempDir);
  });
  
  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  
  describe('initialization', () => {
    it('should create store with empty tree', async () => {
      const state = await store.getTreeState();
      expect(state.leafCount).toBe(0);
      expect(state.rootHash).toBeNull();
    });
    
    it('should generate a public key', () => {
      const publicKey = store.getPublicKey();
      // secp256k1 compressed public key: 33 bytes (66 hex chars)
      expect(publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    });
    
    it('should persist key across reopens', async () => {
      const publicKey1 = store.getPublicKey();
      store.close();
      
      const store2 = await AnchorStore.open(tempDir);
      const publicKey2 = store2.getPublicKey();
      store2.close();
      
      expect(publicKey1).toBe(publicKey2);
    });
  });
  
  describe('commit', () => {
    it('should create commitment with unique ID', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: {
          subject: 'test',
          content: 'Test content',
        },
      });
      
      expect(commitment.id).toMatch(/^commit_[0-9a-f]{24}$/);
    });
    
    it('should sign commitment', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: {
          subject: 'test',
          content: 'Test content',
        },
      });
      
      expect(commitment.signature).toMatch(/^[0-9a-f]{128}$/);
    });
    
    it('should compute leaf hash', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: {
          subject: 'test',
          content: 'Test content',
        },
      });
      
      expect(commitment.leafHash).toMatch(/^[0-9a-f]{64}$/);
    });
    
    it('should assign tree index', async () => {
      const c1 = await store.commit({
        type: 'agreement',
        payload: { subject: 'test 1', content: 'Content 1' },
      });
      
      const c2 = await store.commit({
        type: 'agreement',
        payload: { subject: 'test 2', content: 'Content 2' },
      });
      
      expect(c1.treeIndex).toBe(0);
      expect(c2.treeIndex).toBe(1);
    });
    
    it('should update tree root', async () => {
      const stateBefore = await store.getTreeState();
      expect(stateBefore.rootHash).toBeNull();
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Content' },
      });
      
      const stateAfter = await store.getTreeState();
      expect(stateAfter.rootHash).toMatch(/^[0-9a-f]{64}$/);
    });
    
    it('should persist commitment to database', async () => {
      const commitment = await store.commit({
        type: 'attestation',
        payload: { 
          subject: 'identity',
          content: 'My peer ID is XYZ',
          counterparty: 'peer123',
        },
      });
      
      const retrieved = await store.get(commitment.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(commitment.id);
      expect(retrieved!.type).toBe('attestation');
      expect(retrieved!.payload.subject).toBe('identity');
      expect(retrieved!.payload.counterparty).toBe('peer123');
    });
  });
  
  describe('query', () => {
    beforeEach(async () => {
      // Create test commitments
      await store.commit({
        type: 'agreement',
        payload: { subject: 'code-review', content: 'Review PR #1' },
      });
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'code-review', content: 'Review PR #2', counterparty: 'peer_A' },
      });
      
      await store.commit({
        type: 'attestation',
        payload: { subject: 'identity', content: 'I am peer XYZ' },
      });
      
      await store.commit({
        type: 'state',
        payload: { subject: 'channel:123', content: 'balance: 5000', counterparty: 'peer_A' },
      });
    });
    
    it('should query by type', async () => {
      const agreements = await store.query({ type: 'agreement' });
      expect(agreements).toHaveLength(2);
      
      const attestations = await store.query({ type: 'attestation' });
      expect(attestations).toHaveLength(1);
    });
    
    it('should query by subject', async () => {
      const reviews = await store.query({ subject: 'code-review' });
      expect(reviews).toHaveLength(2);
    });
    
    it('should query by counterparty', async () => {
      const withPeerA = await store.query({ counterparty: 'peer_A' });
      expect(withPeerA).toHaveLength(2);
    });
    
    it('should support limit', async () => {
      const limited = await store.query({ limit: 2 });
      expect(limited).toHaveLength(2);
    });
    
    it('should combine filters', async () => {
      const result = await store.query({ 
        type: 'agreement', 
        counterparty: 'peer_A' 
      });
      expect(result).toHaveLength(1);
      expect(result[0].payload.content).toBe('Review PR #2');
    });
  });
  
  describe('prove', () => {
    it('should return null for non-existent commitment', async () => {
      const proof = await store.prove('nonexistent_id');
      expect(proof).toBeNull();
    });
    
    it('should return null for unanchored commitment', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      // No anchor yet
      const proof = await store.prove(commitment.id);
      expect(proof).toBeNull();
    });
    
    it('should generate valid proof after anchor', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      // Record an anchor
      await store.recordAnchor('fake_txid_' + Date.now().toString(16));
      
      const proof = await store.prove(commitment.id);
      
      expect(proof).not.toBeNull();
      expect(proof!.commitment.id).toBe(commitment.id);
      expect(proof!.merkleProof.leafHash).toBe(commitment.leafHash);
      expect(proof!.anchor.txid).toMatch(/^fake_txid_/);
    });
    
    it('should verify own proofs with signature', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      await store.recordAnchor('fake_txid_' + Date.now().toString(16));
      
      const proof = await store.prove(commitment.id);
      const publicKey = store.getPublicKey();
      const isValid = await AnchorStore.verify(proof!, publicKey);
      
      expect(isValid).toBe(true);
    });
    
    it('should verify inclusion without signature', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      await store.recordAnchor('fake_txid_' + Date.now().toString(16));
      
      const proof = await store.prove(commitment.id);
      const isValid = await AnchorStore.verifyInclusion(proof!);
      
      expect(isValid).toBe(true);
    });
    
    it('should reject proof with wrong public key', async () => {
      const commitment = await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      await store.recordAnchor('fake_txid_' + Date.now().toString(16));
      
      const proof = await store.prove(commitment.id);
      // Wrong public key (random hex)
      const wrongKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const isValid = await AnchorStore.verify(proof!, wrongKey);
      
      expect(isValid).toBe(false);
    });
  });
  
  describe('anchors', () => {
    it('should record anchor', async () => {
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      const anchor = await store.recordAnchor('txid_123');
      
      expect(anchor.txid).toBe('txid_123');
      expect(anchor.anchorIndex).toBe(0);
      expect(anchor.commitmentCount).toBe(1);
      expect(anchor.rootHash).toMatch(/^[0-9a-f]{64}$/);
    });
    
    it('should chain anchors', async () => {
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test 1', content: 'Test 1' },
      });
      
      const anchor1 = await store.recordAnchor('txid_1');
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test 2', content: 'Test 2' },
      });
      
      const anchor2 = await store.recordAnchor('txid_2');
      
      expect(anchor2.anchorIndex).toBe(1);
      expect(anchor2.previousAnchor).toBe('txid_1');
      expect(anchor2.commitmentCount).toBe(2);
    });
    
    it('should track unanchored count', async () => {
      expect(await store.getUnanchoredCount()).toBe(0);
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test 1', content: 'Test 1' },
      });
      
      expect(await store.getUnanchoredCount()).toBe(1);
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test 2', content: 'Test 2' },
      });
      
      expect(await store.getUnanchoredCount()).toBe(2);
      
      await store.recordAnchor('txid_1');
      
      expect(await store.getUnanchoredCount()).toBe(0);
      
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test 3', content: 'Test 3' },
      });
      
      expect(await store.getUnanchoredCount()).toBe(1);
    });
  });
  
  describe('persistence', () => {
    it('should persist commitments across reopens', async () => {
      await store.commit({
        type: 'agreement',
        payload: { subject: 'persistent', content: 'This should persist' },
      });
      
      store.close();
      
      const store2 = await AnchorStore.open(tempDir);
      const commitments = await store2.list();
      
      expect(commitments).toHaveLength(1);
      expect(commitments[0].payload.subject).toBe('persistent');
      
      store2.close();
    });
    
    it('should restore tree state', async () => {
      for (let i = 0; i < 5; i++) {
        await store.commit({
          type: 'agreement',
          payload: { subject: `test ${i}`, content: `Content ${i}` },
        });
      }
      
      const rootBefore = await store.getRoot();
      store.close();
      
      const store2 = await AnchorStore.open(tempDir);
      const rootAfter = await store2.getRoot();
      
      expect(rootAfter).toBe(rootBefore);
      
      // Proofs should still work after restore
      const commitments = await store2.list();
      const publicKey = store2.getPublicKey();
      await store2.recordAnchor('txid_test');
      
      for (const c of commitments) {
        const proof = await store2.prove(c.id);
        expect(await AnchorStore.verify(proof!, publicKey)).toBe(true);
      }
      
      store2.close();
    });
  });
  
  describe('buildAnchorPayload', () => {
    it('should build valid OP_RETURN payload', async () => {
      await store.commit({
        type: 'agreement',
        payload: { subject: 'test', content: 'Test' },
      });
      
      const payload = await store.buildAnchorPayload();
      
      // Check structure: "BSV-ANCHOR" (10) + version (1) + root (32) + count (4) + prev (32) = 79 bytes
      expect(payload.length).toBe(79);
      
      // Check protocol identifier
      const protocol = new TextDecoder().decode(payload.slice(0, 10));
      expect(protocol).toBe('BSV-ANCHOR');
      
      // Check version
      expect(payload[10]).toBe(0x01);
    });
    
    it('should throw for empty tree', async () => {
      await expect(store.buildAnchorPayload()).rejects.toThrow('empty tree');
    });
  });
});
