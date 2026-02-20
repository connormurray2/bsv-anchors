# bsv-anchors: Verifiable Agent Memory

> *"Perfect memory is infeasible — the key is what SUBSET of history is remembered."*  
> — Kocherlakota (1996)

## Executive Summary

`bsv-anchors` is a commitment anchoring system for AI agents. It enables:

1. **Selective memory persistence** — Log important commitments, not full context
2. **Cryptographic verifiability** — Prove what you committed to, and when
3. **Minimal on-chain footprint** — One OP_RETURN per anchor (~0.5 sats)
4. **Privacy by default** — Reveal only what you choose to prove

**Target Outcome:** Agents can build verifiable reputation without centralized storage.

---

## Part of the BSV Agent Toolkit

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                        │
│         (OpenClaw agents, autonomous services)              │
├─────────────────────────────────────────────────────────────┤
│  bsv-anchors  │  Commitment anchoring, verifiable memory   │ ← NEW
├───────────────┼─────────────────────────────────────────────┤
│  bsv-channels │  Payment channels, micropayments           │
├───────────────┼─────────────────────────────────────────────┤
│  bsv-p2p      │  Peer discovery, direct messaging          │
├───────────────┼─────────────────────────────────────────────┤
│  bsv-wallet   │  UTXO management, transaction building     │
└───────────────┴─────────────────────────────────────────────┘
```

**Dependency chain:**
- `bsv-anchors` uses `bsv-wallet` for broadcasting anchor transactions
- `bsv-anchors` uses `bsv-p2p` for commitment proof requests/responses
- `bsv-channels` can use `bsv-anchors` for channel state attestation

---

## Core Concepts

### 1. Commitments

A **commitment** is a statement an agent wants to remember and potentially prove later.

```typescript
interface Commitment {
  // Unique identifier
  id: string;                    // e.g., "commit_abc123"
  
  // What type of commitment
  type: CommitmentType;          // 'agreement' | 'attestation' | 'state' | 'custom'
  
  // The actual content
  payload: {
    subject: string;             // What this is about
    content: string;             // The commitment text/data
    counterparty?: string;       // PeerId or BSV address (if bilateral)
    metadata?: Record<string, unknown>;
  };
  
  // Cryptographic binding
  signature: string;             // Agent's signature over payload
  timestamp: number;             // Unix timestamp
  
  // Tree position (after insertion)
  leafHash?: string;             // SHA256 of canonical commitment
  merkleProof?: string[];        // Proof path to root (populated on query)
}
```

**Commitment Types:**

| Type | Example | Use Case |
|------|---------|----------|
| `agreement` | "I will deliver code review for 100 sats" | Service contracts |
| `attestation` | "My peerId 12D3Koo... controls address 1ABC..." | Identity linking |
| `state` | "Channel with peer X: balance 5000 sats" | Channel checkpoints |
| `custom` | Any structured data | Extensibility |

### 2. Commitment Tree

Commitments are organized in a **Merkle tree** stored locally:

```
                    ┌─────────────┐
                    │  Root Hash  │ ← Anchored to blockchain
                    └──────┬──────┘
               ┌───────────┴───────────┐
          ┌────┴────┐             ┌────┴────┐
          │ Hash AB │             │ Hash CD │
          └────┬────┘             └────┬────┘
        ┌──────┴──────┐       ┌──────┴──────┐
    ┌───┴───┐     ┌───┴───┐ ┌───┴───┐    ┌───┴───┐
    │ Leaf A│     │ Leaf B│ │ Leaf C│    │ Leaf D│
    └───────┘     └───────┘ └───────┘    └───────┘
       ↑             ↑          ↑            ↑
   Agreement    Attestation   State      Agreement
```

**Properties:**
- **Append-only** — New commitments are added as leaves
- **Efficient proofs** — O(log n) proof size for any commitment
- **Tamper-evident** — Any modification changes the root

### 3. Anchors

An **anchor** is a blockchain transaction that proves a commitment tree root existed at a specific time.

```typescript
interface Anchor {
  // On-chain reference
  txid: string;                  // BSV transaction ID
  blockHeight?: number;          // Block height (once confirmed)
  timestamp: number;             // Block timestamp
  
  // What was anchored
  rootHash: string;              // Merkle root at anchor time
  commitmentCount: number;       // Number of commitments in tree
  
  // Metadata
  anchorIndex: number;           // Sequential anchor number
  previousAnchor?: string;       // Previous anchor txid (chain of anchors)
}
```

**Anchor Transaction Format:**

```
OP_FALSE OP_RETURN
  "BSV-ANCHOR"                   // Protocol identifier
  <version: 1 byte>              // Protocol version (0x01)
  <rootHash: 32 bytes>           // Merkle root
  <commitmentCount: 4 bytes>     // Number of commitments (big-endian)
  <previousAnchor: 32 bytes>     // Previous anchor txid (or zeros if first)
```

**Total OP_RETURN size:** 6 + 1 + 32 + 4 + 32 = **75 bytes** (~0.5 sats)

### 4. Proofs

A **proof** demonstrates that a specific commitment was included in an anchored tree.

```typescript
interface CommitmentProof {
  // The commitment being proven
  commitment: Commitment;
  
  // Merkle inclusion proof
  leafHash: string;              // Hash of the commitment
  merkleProof: string[];         // Sibling hashes from leaf to root
  rootHash: string;              // Tree root (must match anchor)
  
  // Anchor reference
  anchor: {
    txid: string;                // Anchor transaction ID
    blockHeight: number;         // Confirmation height
    timestamp: number;           // Block timestamp
  };
}
```

**Verification steps:**
1. Recompute `leafHash` from commitment data
2. Walk `merkleProof` to compute root
3. Verify computed root matches `anchor.rootHash`
4. Verify anchor exists on-chain with that root

---

## Architecture

### Local Storage

```
~/.bsv-anchors/
├── config.json              # Configuration
├── commitments.db           # SQLite: commitments + tree structure
├── anchors.db               # SQLite: anchor history
└── proofs/                  # Cached proofs (optional)
    └── <commitment_id>.json
```

**commitments.db schema:**

```sql
CREATE TABLE commitments (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,       -- JSON
  signature TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  leaf_hash TEXT NOT NULL,
  tree_index INTEGER NOT NULL, -- Position in tree
  created_at INTEGER NOT NULL
);

CREATE TABLE tree_nodes (
  level INTEGER NOT NULL,      -- 0 = leaves, increasing toward root
  index INTEGER NOT NULL,      -- Position at this level
  hash TEXT NOT NULL,
  PRIMARY KEY (level, index)
);

CREATE TABLE tree_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: 'root_hash', 'leaf_count', 'last_anchor_index'
```

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      bsv-anchors                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Commitment  │  │   Merkle    │  │   Anchor    │        │
│  │   Store     │  │    Tree     │  │   Manager   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │
│         └────────────────┼────────────────┘                │
│                          │                                 │
│                    ┌─────┴─────┐                           │
│                    │   Core    │                           │
│                    │   Engine  │                           │
│                    └─────┬─────┘                           │
│                          │                                 │
│         ┌────────────────┼────────────────┐                │
│         │                │                │                │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐        │
│  │    CLI      │  │   HTTP API  │  │  P2P Proto  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                 │                │
         ▼                 ▼                ▼
    Terminal          Localhost         bsv-p2p
                                      (proof requests)
```

---

## API Design

### CLI

```bash
# Initialize anchor store
bsv-anchors init

# Add a commitment
bsv-anchors commit \
  --type agreement \
  --subject "code-review for peer 12D3KooW..." \
  --content "Will review PR #42 for 100 sats, deliver within 24h"

# Add an identity attestation
bsv-anchors attest \
  --peer-id "12D3KooWABC123..." \
  --bsv-address "1ABC..."

# Anchor current tree to blockchain
bsv-anchors anchor
# Output: Anchored 15 commitments. TXID: abc123...

# Generate proof for a commitment
bsv-anchors prove <commitment_id>
# Output: JSON proof object

# Verify a proof
bsv-anchors verify <proof.json>
# Output: ✅ Valid. Commitment anchored at block 850123 (2026-02-20)

# List commitments
bsv-anchors list [--type agreement] [--since 2026-01-01]

# Show anchor history
bsv-anchors anchors
```

### TypeScript API

```typescript
import { AnchorStore, Commitment, CommitmentProof } from 'bsv-anchors';

// Initialize
const store = await AnchorStore.open('~/.bsv-anchors');

// Add commitment
const commitment = await store.commit({
  type: 'agreement',
  payload: {
    subject: 'code-review',
    content: 'Will review PR #42 for 100 sats',
    counterparty: '12D3KooWABC123...',
    metadata: { deadline: '2026-02-21T18:00:00Z' }
  }
});

// Anchor to blockchain (requires bsv-wallet)
const anchor = await store.anchor({
  wallet: walletInstance,  // from bsv-wallet
  feeRate: 0.5             // sats/byte
});
console.log(`Anchored at ${anchor.txid}`);

// Generate proof
const proof = await store.prove(commitment.id);

// Verify proof (can be done by anyone)
const isValid = await AnchorStore.verify(proof);

// Query commitments
const agreements = await store.query({
  type: 'agreement',
  counterparty: '12D3KooWABC123...',
  since: new Date('2026-01-01')
});
```

### P2P Protocol

New protocol for proof requests over bsv-p2p:

**Protocol ID:** `/bsv-anchors/proof/1.0.0`

**Request:**
```typescript
interface ProofRequest {
  // What to prove
  commitmentId?: string;         // Specific commitment
  query?: {                      // Or query for commitments
    type?: CommitmentType;
    subject?: string;
    counterparty?: string;
    since?: number;
  };
  
  // Verification preferences
  requireConfirmed?: boolean;    // Only anchored commitments
  minConfirmations?: number;     // Minimum block confirmations
}
```

**Response:**
```typescript
interface ProofResponse {
  proofs: CommitmentProof[];     // Matching proofs
  error?: string;                // If request failed
}
```

**Example flow:**

```
Agent A                                    Agent B
   │                                          │
   │  "Prove you agreed to review my code"    │
   │ ──────────────────────────────────────►  │
   │                                          │
   │     ProofRequest {                       │
   │       query: {                           │
   │         type: 'agreement',               │
   │         counterparty: A.peerId,          │
   │         subject: 'code-review'           │
   │       }                                  │
   │     }                                    │
   │                                          │
   │  ◄──────────────────────────────────────  │
   │     ProofResponse {                      │
   │       proofs: [{                         │
   │         commitment: {...},               │
   │         merkleProof: [...],              │
   │         anchor: { txid: '...', ... }     │
   │       }]                                 │
   │     }                                    │
   │                                          │
   │  (A verifies proof locally)              │
   │                                          │
```

### OpenClaw Tools

```typescript
// anchors_commit - Record a commitment
{
  name: 'anchors_commit',
  description: 'Record a commitment to local store',
  parameters: {
    type: { type: 'string', enum: ['agreement', 'attestation', 'state', 'custom'] },
    subject: { type: 'string', description: 'What this commitment is about' },
    content: { type: 'string', description: 'The commitment content' },
    counterparty: { type: 'string', description: 'PeerId or address (optional)' }
  }
}

// anchors_anchor - Anchor tree to blockchain
{
  name: 'anchors_anchor',
  description: 'Anchor current commitment tree to BSV blockchain',
  parameters: {}  // Uses configured wallet
}

// anchors_prove - Generate proof for commitment
{
  name: 'anchors_prove',
  description: 'Generate cryptographic proof of a commitment',
  parameters: {
    commitmentId: { type: 'string' }
  }
}

// anchors_verify - Verify a proof
{
  name: 'anchors_verify',
  description: 'Verify a commitment proof',
  parameters: {
    proof: { type: 'object', description: 'The proof object to verify' }
  }
}

// anchors_request - Request proof from peer
{
  name: 'anchors_request',
  description: 'Request commitment proof from another agent via P2P',
  parameters: {
    peerId: { type: 'string' },
    query: { type: 'object', description: 'Query parameters' }
  }
}
```

---

## Use Cases

### 1. Verifiable Service Agreements

```typescript
// Agent A requests service
const agreement = await anchors.commit({
  type: 'agreement',
  payload: {
    subject: 'code-review',
    content: 'Agent B will review PR #42 for 100 sats within 24h',
    counterparty: agentB.peerId
  }
});

// Agent B also commits (bilateral agreement)
// Both agents now have anchored proof of the agreement

// If dispute arises, either can prove what was agreed
const proof = await anchors.prove(agreement.id);
// Proof shows: exact terms, timestamp, both signatures
```

### 2. Reputation Without Central Storage

```typescript
// Query: "Has this agent ever broken a commitment?"

// Agent shares all their agreement commitments
const proofs = await peer.requestProofs({
  type: 'agreement',
  since: sixMonthsAgo
});

// Verifier checks:
// 1. All proofs are valid (anchored on-chain)
// 2. No contradicting commitments
// 3. Pattern of fulfillment (via linked payment proofs)

// Result: Decentralized reputation score
```

### 3. Channel State Attestation

```typescript
// Periodically anchor channel state
await anchors.commit({
  type: 'state',
  payload: {
    subject: `channel:${channelId}`,
    content: JSON.stringify({
      balanceA: 5000,
      balanceB: 5000,
      updateNum: 42
    }),
    counterparty: peer.id
  }
});

// If dispute: prove what the agreed state was at any point
```

### 4. Identity Continuity

```typescript
// Agent gets new keys but wants to prove continuity
await anchors.commit({
  type: 'attestation',
  payload: {
    subject: 'identity-migration',
    content: JSON.stringify({
      oldPeerId: '12D3KooWOLD...',
      newPeerId: '12D3KooWNEW...',
      oldBsvAddress: '1OLD...',
      newBsvAddress: '1NEW...'
    })
  }
});

// Later: prove the new identity is the same agent
```

---

## Anchoring Strategies

### 1. Time-Based (Default)

Anchor every N hours regardless of commitment count.

```typescript
const config = {
  anchorStrategy: 'time',
  anchorIntervalHours: 24,  // Once per day
};
```

**Cost:** ~0.5 sats/day = ~15 sats/month

### 2. Count-Based

Anchor when N new commitments accumulate.

```typescript
const config = {
  anchorStrategy: 'count',
  anchorThreshold: 100,  // Every 100 commitments
};
```

**Cost:** Varies with activity

### 3. Importance-Based

Anchor immediately for high-value commitments.

```typescript
const config = {
  anchorStrategy: 'importance',
  immediateTypes: ['agreement'],     // Anchor agreements immediately
  batchTypes: ['state', 'custom'],   // Batch others
  batchIntervalHours: 24
};
```

### 4. Manual

Agent explicitly triggers anchors.

```bash
bsv-anchors anchor  # When you want
```

---

## Privacy Considerations

### Selective Disclosure

Commitments are stored locally. You choose what to prove:

```typescript
// Only prove specific commitment
const proof = await anchors.prove(commitmentId);

// Proof reveals:
// ✅ The commitment content
// ✅ When it was made (anchor timestamp)
// ✅ It hasn't been modified

// Proof does NOT reveal:
// ❌ Other commitments in the tree
// ❌ Total number of commitments (only count at anchor time)
// ❌ Any commitment you don't choose to share
```

### Encrypted Commitments (Optional)

For sensitive commitments, encrypt before storing:

```typescript
const commitment = await anchors.commit({
  type: 'custom',
  payload: {
    subject: 'encrypted',
    content: encrypt(sensitiveData, sharedKey),
    metadata: { encrypted: true }
  }
});

// Proof shows commitment exists, but content is encrypted
// Only parties with sharedKey can read it
```

### Zero-Knowledge Proofs (Future)

Potential extension: prove properties without revealing content.

```typescript
// "I have at least 10 fulfilled agreements with this counterparty"
// Without revealing the specific agreements
```

---

## Integration with Existing Tools

### bsv-wallet

```typescript
import { Wallet } from 'bsv-wallet';
import { AnchorStore } from 'bsv-anchors';

const wallet = await Wallet.open('~/.bsv-wallet');
const anchors = await AnchorStore.open('~/.bsv-anchors');

// Anchor uses wallet to broadcast
await anchors.anchor({ wallet });
```

### bsv-p2p

```typescript
import { P2PNode } from 'bsv-p2p';
import { AnchorStore, ProofProtocol } from 'bsv-anchors';

const node = await P2PNode.create();
const anchors = await AnchorStore.open('~/.bsv-anchors');

// Register proof protocol handler
node.handle(ProofProtocol.ID, async (stream, peerId) => {
  const request = await ProofProtocol.readRequest(stream);
  const proofs = await anchors.queryProofs(request.query);
  await ProofProtocol.writeResponse(stream, { proofs });
});

// Request proofs from peer
const proofs = await ProofProtocol.request(node, peerId, {
  query: { type: 'agreement', counterparty: myPeerId }
});
```

### bsv-channels

```typescript
import { Channel } from 'bsv-channels';
import { AnchorStore } from 'bsv-anchors';

const channel = await Channel.open(peer, { amount: 10000 });
const anchors = await AnchorStore.open('~/.bsv-anchors');

// Anchor channel state on significant updates
channel.on('update', async (state) => {
  if (state.updateNum % 10 === 0) {  // Every 10 updates
    await anchors.commit({
      type: 'state',
      payload: {
        subject: `channel:${channel.id}`,
        content: JSON.stringify(state),
        counterparty: channel.peer
      }
    });
  }
});
```

---

## Implementation Roadmap

### Phase 1: Core (Week 1)

- [ ] SQLite storage for commitments and tree
- [ ] Merkle tree implementation (append-only)
- [ ] Commitment signing with Ed25519
- [ ] CLI: `init`, `commit`, `list`

### Phase 2: Anchoring (Week 2)

- [ ] Anchor transaction building (OP_RETURN)
- [ ] Integration with bsv-wallet
- [ ] CLI: `anchor`, `anchors`
- [ ] Automatic anchoring strategies

### Phase 3: Proofs (Week 3)

- [ ] Merkle proof generation
- [ ] Proof verification (local)
- [ ] On-chain anchor verification (via WhatsOnChain)
- [ ] CLI: `prove`, `verify`

### Phase 4: P2P Integration (Week 4)

- [ ] Proof request/response protocol
- [ ] Integration with bsv-p2p
- [ ] OpenClaw plugin
- [ ] Agent tools

### Phase 5: Polish (Week 5)

- [ ] Documentation
- [ ] Examples
- [ ] Tests (unit + integration)
- [ ] npm publish

---

## Open Questions

1. **Should commitments be revocable?**
   - Pro: Flexibility for mistakes
   - Con: Weakens trust guarantees
   - Possible: Allow revocation but it's visible in history

2. **Should we support multi-party commitments?**
   - Currently: Bilateral (me + counterparty)
   - Future: N-of-M signatures for group agreements

3. **How to handle commitment disputes?**
   - Anchors prove what was agreed
   - Fulfillment requires separate proof (payment, delivery)
   - Could integrate with arbitration service

4. **Should we charge for proof generation?**
   - Makes DoS attacks costly
   - Natural fit with bsv-channels

---

## Conclusion

`bsv-anchors` completes the BSV Agent Toolkit by adding **verifiable memory**:

| Package | What It Does | Memory Equivalent |
|---------|--------------|-------------------|
| bsv-wallet | Hold and spend money | "How much do I have?" |
| bsv-p2p | Find and message peers | "Who's out there?" |
| bsv-channels | Stream micropayments | "What's our running balance?" |
| **bsv-anchors** | **Prove commitments** | **"What did we agree to?"** |

Together, they form a complete economic substrate for autonomous agents — money AND memory, as Kocherlakota proved they must be.

---

*Draft: 2026-02-20*
*Author: Moneo*
