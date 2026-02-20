/**
 * OpenClaw Plugin Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnchorsPlugin, createPlugin, TOOL_DEFINITIONS } from '../../src/openclaw/plugin.js';

describe('OpenClaw Plugin', () => {
  let plugin: ReturnType<typeof createPlugin>;
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bsv-anchors-plugin-test-'));
    plugin = createPlugin({ dataDir: tempDir });
    await plugin.initialize();
  });
  
  afterEach(() => {
    plugin.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  
  describe('plugin metadata', () => {
    it('should have correct name and version', () => {
      expect(plugin.name).toBe('bsv-anchors');
      expect(plugin.version).toBe('0.1.0');
    });
    
    it('should expose tool definitions', () => {
      expect(plugin.tools).toHaveLength(7);
      expect(plugin.tools.map(t => t.name)).toContain('anchors_commit');
      expect(plugin.tools.map(t => t.name)).toContain('anchors_prove');
    });
  });
  
  describe('TOOL_DEFINITIONS', () => {
    it('should have correct structure', () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.name).toMatch(/^anchors_/);
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });
    
    it('should have required fields for anchors_commit', () => {
      const commitTool = TOOL_DEFINITIONS.find(t => t.name === 'anchors_commit');
      expect(commitTool?.inputSchema.required).toContain('type');
      expect(commitTool?.inputSchema.required).toContain('subject');
      expect(commitTool?.inputSchema.required).toContain('content');
    });
  });
  
  describe('anchors_commit', () => {
    it('should create a commitment', async () => {
      const result = await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'test-service',
        content: 'Will provide test service for 100 sats',
      });
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('✅ Commitment created');
      expect(result.content[0].text).toContain('commit_');
    });
    
    it('should include counterparty when provided', async () => {
      const result = await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'bilateral',
        content: 'Agreement with peer',
        counterparty: '12D3KooWTest',
      });
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('✅ Commitment created');
    });
  });
  
  describe('anchors_list', () => {
    it('should return empty when no commitments', async () => {
      const result = await plugin.executeTool('anchors_list', {});
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('No commitments found');
    });
    
    it('should list created commitments', async () => {
      await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'test',
        content: 'Test content',
      });
      
      const result = await plugin.executeTool('anchors_list', {});
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Found 1 commitment');
      expect(result.content[0].text).toContain('agreement');
    });
    
    it('should filter by type', async () => {
      await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'agreement',
        content: 'Agreement content',
      });
      await plugin.executeTool('anchors_commit', {
        type: 'attestation',
        subject: 'identity',
        content: 'Identity claim',
      });
      
      const result = await plugin.executeTool('anchors_list', { type: 'attestation' });
      
      expect(result.content[0].text).toContain('Found 1 commitment');
      expect(result.content[0].text).toContain('identity');
    });
  });
  
  describe('anchors_prove', () => {
    it('should error for non-existent commitment', async () => {
      const result = await plugin.executeTool('anchors_prove', {
        commitmentId: 'nonexistent',
      });
      
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain('Could not generate proof');
    });
    
    it('should error for unanchored commitment', async () => {
      const commitResult = await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'test',
        content: 'Test',
      });
      
      // Extract commitment ID from result
      const match = commitResult.content[0].text.match(/`(commit_[a-f0-9]+)`/);
      const commitmentId = match?.[1];
      
      const result = await plugin.executeTool('anchors_prove', { commitmentId });
      
      // Should fail because not anchored
      expect(result.isError).toBeTruthy();
    });
  });
  
  describe('anchors_status', () => {
    it('should return status', async () => {
      const result = await plugin.executeTool('anchors_status', {});
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Anchor Store Status');
      expect(result.content[0].text).toContain('Public key');
      expect(result.content[0].text).toContain('Total commitments');
    });
    
    it('should show commitment count', async () => {
      await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'test',
        content: 'Test',
      });
      
      const result = await plugin.executeTool('anchors_status', {});
      
      expect(result.content[0].text).toContain('Total commitments:** 1');
    });
  });
  
  describe('anchors_anchor', () => {
    it('should report nothing to anchor when empty', async () => {
      const result = await plugin.executeTool('anchors_anchor', {});
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Nothing to anchor');
    });
    
    it('should handle dry run', async () => {
      await plugin.executeTool('anchors_commit', {
        type: 'agreement',
        subject: 'test',
        content: 'Test',
      });
      
      const result = await plugin.executeTool('anchors_anchor', { dryRun: true });
      
      // Will either show dry run info or wallet not available
      expect(result.isError).toBeFalsy();
    });
  });
  
  describe('anchors_verify', () => {
    it('should verify inclusion proof', async () => {
      // Create a mock proof
      const mockProof = {
        commitment: {
          id: 'commit_test',
          type: 'agreement',
          payload: { subject: 'test', content: 'test' },
          signature: 'sig',
          timestamp: Date.now(),
          leafHash: 'hash',
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
      
      const result = await plugin.executeTool('anchors_verify', { proof: mockProof });
      
      // Will fail verification but should not error
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toMatch(/VALID|INVALID/);
    });
  });
  
  describe('anchors_request', () => {
    it('should return P2P instructions', async () => {
      const result = await plugin.executeTool('anchors_request', {
        peerId: '12D3KooWTest123',
        type: 'agreement',
      });
      
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('P2P Proof Request');
      expect(result.content[0].text).toContain('12D3KooWTest123');
    });
  });
  
  describe('error handling', () => {
    it('should return error for unknown tool', async () => {
      const result = await plugin.executeTool('unknown_tool', {});
      
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });
});

describe('AnchorsPlugin class', () => {
  it('should be instantiable', () => {
    const plugin = new AnchorsPlugin();
    expect(plugin).toBeDefined();
  });
  
  it('should return tools before initialization', () => {
    const plugin = new AnchorsPlugin();
    const tools = plugin.getTools();
    expect(tools).toHaveLength(7);
  });
});
