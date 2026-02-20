# bsv-anchors

**Verifiable agent memory.** Anchor commitments to BSV, prove them anywhere.

> *"Perfect memory is infeasible — the key is what SUBSET of history is remembered."*  
> — Kocherlakota (1996)

---

## Part of the BSV Agent Toolkit

| Package | Purpose |
|---------|---------|
| [bsv-wallet](https://github.com/galt-tr/bsv-wallet) | Money layer — manage satoshis |
| [bsv-p2p](https://github.com/galt-tr/bsv-p2p) | Network layer — find peers, send messages |
| [bsv-channels](https://github.com/galt-tr/bsv-channels) | Payment layer — micropayment channels |
| **bsv-anchors** (this) | Memory layer — verifiable commitments |

---

## The Problem

AI agents have brutal memory constraints:

| Constraint | Impact |
|------------|--------|
| Context window limits | Forget earlier conversations |
| Session isolation | Wake up fresh, no memory of yesterday |
| Cross-agent opacity | No idea what other agents know |
| Trust verification | How to prove past agreements? |

## The Solution

**Selective commitment anchoring.** Not full context (expensive, noisy), but important commitments:

- Service agreements
- Identity attestations  
- Channel states
- Reputation claims

One Merkle root anchored to BSV = unlimited commitments proven.

---

## Quick Start

```bash
# Install
npm install bsv-anchors

# Initialize
bsv-anchors init

# Make a commitment
bsv-anchors commit \
  --type agreement \
  --subject "code-review for 12D3KooW..." \
  --content "Will review PR #42 for 100 sats within 24h"

# Anchor to blockchain (costs ~0.5 sats)
bsv-anchors anchor

# Generate proof
bsv-anchors prove commit_abc123

# Verify proof (anyone can do this)
bsv-anchors verify proof.json
```

---

## How It Works

```
┌─────────────────────────────────────────┐
│         Local Context (ephemeral)       │
│  - Full conversation history            │
│  - Reasoning traces                     │
└──────────────────┬──────────────────────┘
                   │ extract important bits
                   ▼
┌─────────────────────────────────────────┐
│      Commitment Merkle Tree (local)     │
│  - "Agreed: 100 sats for code review"   │
│  - "Identity: peer X = address Y"       │
└──────────────────┬──────────────────────┘
                   │ anchor (periodic)
                   ▼
┌─────────────────────────────────────────┐
│         BSV Blockchain (permanent)      │
│  - 75-byte OP_RETURN with Merkle root   │
│  - Proves: "At time T, these existed"   │
└─────────────────────────────────────────┘
```

**Cost:** ~0.5 sats per anchor (unlimited commitments per anchor)

---

## Use Cases

### Verifiable Service Agreements

```typescript
// Both parties commit to the same agreement
await anchors.commit({
  type: 'agreement',
  payload: {
    subject: 'code-review',
    content: 'Review PR #42 for 100 sats within 24h',
    counterparty: '12D3KooW...'
  }
});

// Later: prove what was agreed
const proof = await anchors.prove(commitmentId);
// Proof is cryptographically verifiable by anyone
```

### Decentralized Reputation

```typescript
// Request proof of past agreements from peer
const proofs = await peer.requestProofs({
  type: 'agreement',
  since: sixMonthsAgo
});

// Verify all proofs, check for fulfillment
// Result: trustless reputation score
```

### Identity Continuity

```typescript
// Prove old identity links to new identity
await anchors.commit({
  type: 'attestation',
  payload: {
    subject: 'identity-migration',
    content: JSON.stringify({
      oldPeerId: '12D3KooWOLD...',
      newPeerId: '12D3KooWNEW...'
    })
  }
});
```

---

## API

### CLI

```bash
bsv-anchors init                    # Initialize store
bsv-anchors commit --type <type>    # Add commitment
bsv-anchors anchor                  # Anchor to blockchain
bsv-anchors prove <id>              # Generate proof
bsv-anchors verify <proof.json>     # Verify proof
bsv-anchors list                    # List commitments
bsv-anchors anchors                 # Show anchor history
```

### TypeScript

```typescript
import { AnchorStore } from 'bsv-anchors';

const store = await AnchorStore.open();

// Commit
const c = await store.commit({ type, payload });

// Anchor
const a = await store.anchor({ wallet });

// Prove
const p = await store.prove(c.id);

// Verify
const valid = await AnchorStore.verify(p);
```

### OpenClaw Tools

- `anchors_commit` — Record a commitment
- `anchors_anchor` — Anchor tree to blockchain
- `anchors_prove` — Generate proof
- `anchors_verify` — Verify proof
- `anchors_request` — Request proof from peer via P2P

---

## Why BSV?

| Feature | BSV | Ethereum | BTC |
|---------|-----|----------|-----|
| OP_RETURN size | Unlimited | N/A | 80 bytes |
| Cost per anchor | ~0.5 sats | $5-50 | $2-20 |
| Confirmation time | ~10 min | ~15 min | ~10 min |
| Permanent storage | ✅ Yes | ⚠️ State rent | ✅ Yes |

BSV is the only blockchain where anchoring is economically viable at scale.

---

## Documentation

- [VISION.md](./VISION.md) — Full design document
- [docs/PROTOCOL.md](./docs/PROTOCOL.md) — Wire protocol specification
- [docs/MERKLE.md](./docs/MERKLE.md) — Merkle tree implementation
- [examples/](./examples/) — Usage examples

---

## Status

🚧 **Design phase** — Implementation not started.

See [VISION.md](./VISION.md) for the complete specification.

---

## License

MIT
