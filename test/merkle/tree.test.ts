/**
 * Merkle Tree Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleTree, hashLeaf, hashInternal, canonicalizeCommitment } from '../../src/merkle/tree.js';

describe('MerkleTree', () => {
  let tree: MerkleTree;
  
  beforeEach(() => {
    tree = new MerkleTree();
  });
  
  describe('hashLeaf', () => {
    it('should produce consistent hashes for same input', () => {
      const hash1 = hashLeaf('test data');
      const hash2 = hashLeaf('test data');
      expect(hash1).toBe(hash2);
    });
    
    it('should produce different hashes for different input', () => {
      const hash1 = hashLeaf('data 1');
      const hash2 = hashLeaf('data 2');
      expect(hash1).not.toBe(hash2);
    });
    
    it('should produce 64-character hex string', () => {
      const hash = hashLeaf('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
  
  describe('hashInternal', () => {
    it('should be order-dependent (position matters)', () => {
      const hash1 = hashInternal('aaa', 'bbb');
      const hash2 = hashInternal('bbb', 'aaa');
      // Order MUST matter for proper Merkle tree semantics
      expect(hash1).not.toBe(hash2);
    });
    
    it('should produce different hashes for different inputs', () => {
      const hash1 = hashInternal('aaa', 'bbb');
      const hash2 = hashInternal('aaa', 'ccc');
      expect(hash1).not.toBe(hash2);
    });
  });
  
  describe('leaf order preservation', () => {
    it('should produce different roots for different leaf orders', () => {
      const tree1 = new MerkleTree();
      tree1.addLeaf('A');
      tree1.addLeaf('B');
      
      const tree2 = new MerkleTree();
      tree2.addLeaf('B');
      tree2.addLeaf('A');
      
      // These MUST be different - order matters!
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });
  });
  
  describe('empty tree', () => {
    it('should have null root', () => {
      expect(tree.getRoot()).toBeNull();
    });
    
    it('should have zero leaf count', () => {
      expect(tree.leafCount).toBe(0);
    });
  });
  
  describe('single leaf', () => {
    it('should have root equal to leaf hash', () => {
      const { hash } = tree.addLeaf('single leaf');
      expect(tree.getRoot()).toBe(hash);
    });
    
    it('should have leaf count of 1', () => {
      tree.addLeaf('single leaf');
      expect(tree.leafCount).toBe(1);
    });
  });
  
  describe('two leaves', () => {
    it('should compute correct root', () => {
      const { hash: h1 } = tree.addLeaf('leaf 1');
      const { hash: h2 } = tree.addLeaf('leaf 2');
      
      const expectedRoot = hashInternal(h1, h2);
      expect(tree.getRoot()).toBe(expectedRoot);
    });
    
    it('should have leaf count of 2', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      expect(tree.leafCount).toBe(2);
    });
  });
  
  describe('four leaves (complete tree)', () => {
    it('should compute correct root', () => {
      const h1 = tree.addLeaf('leaf 1').hash;
      const h2 = tree.addLeaf('leaf 2').hash;
      const h3 = tree.addLeaf('leaf 3').hash;
      const h4 = tree.addLeaf('leaf 4').hash;
      
      // Level 1
      const l1_0 = hashInternal(h1, h2);
      const l1_1 = hashInternal(h3, h4);
      
      // Root
      const expectedRoot = hashInternal(l1_0, l1_1);
      expect(tree.getRoot()).toBe(expectedRoot);
    });
  });
  
  describe('three leaves (incomplete tree)', () => {
    it('should handle odd number of leaves', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      tree.addLeaf('leaf 3');
      
      expect(tree.getRoot()).toBeDefined();
      expect(tree.leafCount).toBe(3);
    });
  });
  
  describe('proof generation', () => {
    it('should return null for invalid index', () => {
      tree.addLeaf('leaf 1');
      expect(tree.generateProof(-1)).toBeNull();
      expect(tree.generateProof(1)).toBeNull();
      expect(tree.generateProof(100)).toBeNull();
    });
    
    it('should generate valid proof for single leaf', () => {
      const { hash } = tree.addLeaf('single leaf');
      const proof = tree.generateProof(0);
      
      expect(proof).not.toBeNull();
      expect(proof!.leafHash).toBe(hash);
      expect(proof!.leafIndex).toBe(0);
      expect(proof!.rootHash).toBe(tree.getRoot());
    });
    
    it('should generate valid proof for two leaves', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      
      const proof0 = tree.generateProof(0);
      const proof1 = tree.generateProof(1);
      
      expect(proof0).not.toBeNull();
      expect(proof1).not.toBeNull();
      
      // Both should verify
      expect(MerkleTree.verifyProof(proof0!)).toBe(true);
      expect(MerkleTree.verifyProof(proof1!)).toBe(true);
    });
    
    it('should generate valid proofs for larger tree', () => {
      // Add 10 leaves
      for (let i = 0; i < 10; i++) {
        tree.addLeaf(`leaf ${i}`);
      }
      
      // All proofs should verify
      for (let i = 0; i < 10; i++) {
        const proof = tree.generateProof(i);
        expect(proof).not.toBeNull();
        expect(MerkleTree.verifyProof(proof!)).toBe(true);
      }
    });
    
    it('should generate valid proofs for power-of-2 tree', () => {
      // Add 16 leaves (complete binary tree)
      for (let i = 0; i < 16; i++) {
        tree.addLeaf(`leaf ${i}`);
      }
      
      // All proofs should verify
      for (let i = 0; i < 16; i++) {
        const proof = tree.generateProof(i);
        expect(proof).not.toBeNull();
        expect(MerkleTree.verifyProof(proof!)).toBe(true);
      }
    });
  });
  
  describe('proof verification', () => {
    it('should reject tampered leaf hash', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      
      const proof = tree.generateProof(0)!;
      // Use valid hex but wrong value
      proof.leafHash = '0000000000000000000000000000000000000000000000000000000000000000';
      
      expect(MerkleTree.verifyProof(proof)).toBe(false);
    });
    
    it('should reject tampered sibling hash', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      
      const proof = tree.generateProof(0)!;
      // Use valid hex but wrong value
      proof.siblings[0].hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      
      expect(MerkleTree.verifyProof(proof)).toBe(false);
    });
    
    it('should reject wrong root hash', () => {
      tree.addLeaf('leaf 1');
      tree.addLeaf('leaf 2');
      
      const proof = tree.generateProof(0)!;
      // Use valid hex but wrong value
      proof.rootHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      
      expect(MerkleTree.verifyProof(proof)).toBe(false);
    });
  });
  
  describe('persistence', () => {
    it('should export and import all nodes', () => {
      // Build a tree
      for (let i = 0; i < 7; i++) {
        tree.addLeaf(`leaf ${i}`);
      }
      
      const originalRoot = tree.getRoot();
      const nodes = tree.getAllNodes();
      
      // Rebuild from nodes
      const restored = MerkleTree.fromNodes(nodes);
      
      expect(restored.getRoot()).toBe(originalRoot);
      expect(restored.leafCount).toBe(7);
    });
    
    it('should maintain proof validity after restore', () => {
      // Build a tree
      for (let i = 0; i < 5; i++) {
        tree.addLeaf(`leaf ${i}`);
      }
      
      const nodes = tree.getAllNodes();
      const restored = MerkleTree.fromNodes(nodes);
      
      // Proofs from restored tree should verify
      for (let i = 0; i < 5; i++) {
        const proof = restored.generateProof(i);
        expect(MerkleTree.verifyProof(proof!)).toBe(true);
      }
    });
  });
  
  describe('addLeafHash', () => {
    it('should allow adding pre-computed hashes', () => {
      const hash1 = hashLeaf('data 1');
      const hash2 = hashLeaf('data 2');
      
      tree.addLeafHash(hash1);
      tree.addLeafHash(hash2);
      
      expect(tree.leafCount).toBe(2);
      expect(tree.getRoot()).toBe(hashInternal(hash1, hash2));
    });
  });
});

describe('canonicalizeCommitment', () => {
  it('should produce consistent output regardless of property order', () => {
    const c1 = {
      id: 'test_1',
      type: 'agreement',
      payload: { subject: 'test', content: 'hello' },
      timestamp: 12345,
      signature: 'sig123',
    };
    
    const c2 = {
      signature: 'sig123',
      timestamp: 12345,
      id: 'test_1',
      payload: { content: 'hello', subject: 'test' },
      type: 'agreement',
    };
    
    expect(canonicalizeCommitment(c1)).toBe(canonicalizeCommitment(c2));
  });
  
  it('should handle nested objects', () => {
    const commitment = {
      id: 'test_1',
      type: 'custom',
      payload: {
        subject: 'test',
        content: 'hello',
        metadata: { z: 3, a: 1, m: 2 },
      },
      timestamp: 12345,
      signature: 'sig',
    };
    
    const canonical = canonicalizeCommitment(commitment);
    
    // Metadata keys should be sorted
    expect(canonical).toContain('"a":1');
    expect(canonical).toContain('"m":2');
    expect(canonical).toContain('"z":3');
  });
});
