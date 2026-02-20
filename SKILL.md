# bsv-anchors Skill

Verifiable agent memory — anchor commitments to BSV blockchain.

## Installation

```bash
# Clone the repo
git clone https://github.com/galt-tr/bsv-anchors.git
cd bsv-anchors

# Install dependencies
npm install

# Build
npm run build

# Install as OpenClaw plugin
openclaw plugins install -l ./
```

## Configuration

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "bsv-anchors": {
        "enabled": true,
        "config": {
          "dataDir": "~/.bsv-anchors",
          "enableP2P": true
        }
      }
    }
  }
}
```

Then restart the gateway:
```bash
openclaw gateway restart
```

## Available Tools

### anchors_commit
Create a signed commitment that can be anchored to blockchain.

**Parameters:**
- `type` (required): `agreement` | `attestation` | `state` | `custom`
- `subject` (required): What this commitment is about
- `content` (required): The commitment content
- `counterparty` (optional): PeerId or BSV address

**Example:**
```
Create a commitment that I'll provide code review services for 100 sats
```

### anchors_list
List commitments with optional filters.

**Parameters:**
- `type`: Filter by type
- `subject`: Filter by subject (substring)
- `counterparty`: Filter by counterparty
- `limit`: Max results (default 20)

**Example:**
```
List all my agreement commitments
```

### anchors_prove
Generate a cryptographic proof for a commitment.

**Parameters:**
- `commitmentId` (required): ID of the commitment

**Example:**
```
Generate a proof for commit_abc123
```

### anchors_verify
Verify a commitment proof.

**Parameters:**
- `proof` (required): The proof object
- `publicKey` (optional): Public key for signature verification

**Example:**
```
Verify this proof: { ... }
```

### anchors_anchor
Anchor pending commitments to BSV blockchain.

**Parameters:**
- `dryRun`: Preview without broadcasting
- `feeRate`: Sats per byte (default 0.5)

**Example:**
```
Anchor all my pending commitments to BSV
```

### anchors_status
Show anchor store status.

**Example:**
```
What's my anchors status?
```

### anchors_request
Request proofs from another agent via P2P.

**Parameters:**
- `peerId` (required): Target peer ID
- `commitmentId`: Specific commitment
- `type`: Filter by type
- `counterparty`: Filter by counterparty

**Example:**
```
Request all agreement proofs from peer 12D3KooW...
```

## Use Cases

### Service Agreements
```
Agent: Create a commitment that I'll review the user's PR for 100 sats within 24 hours

Tool: anchors_commit
  type: agreement
  subject: code-review
  content: Will review PR within 24h for 100 sats
  counterparty: 12D3KooW...
```

### Identity Attestation
```
Agent: Create an attestation linking my peer ID to my BSV address

Tool: anchors_commit
  type: attestation
  subject: identity
  content: Peer 12D3KooWABC controls address 1ABC...
```

### Proving Past Agreements
```
Agent: Prove to peer X that I made commitment ABC

Tool: anchors_prove
  commitmentId: commit_abc123

// Returns proof with:
// - Merkle inclusion proof
// - Anchor TXID (on-chain reference)
// - Signature
```

### Verifying Peer Claims
```
Agent: Verify this proof from peer Y

Tool: anchors_verify
  proof: { ... }
  publicKey: <peer_public_key>

// Returns: VALID or INVALID
```

## Integration with BSV Agent Toolkit

bsv-anchors is part of the BSV Agent Toolkit:

| Package | Purpose |
|---------|---------|
| bsv-wallet | Hold and spend satoshis |
| bsv-p2p | Find peers, send messages |
| bsv-channels | Micropayment channels |
| **bsv-anchors** | Verifiable commitments |

## Theoretical Foundation

Based on Kocherlakota's "Money is Memory" (1996): money and memory are functionally equivalent. Payment channels compress payment history; anchors compress commitment history.

See `docs/MONEY-IS-MEMORY.md` for the full analysis.

## Local Notes

Add your configuration notes here:
- Data directory: 
- Wallet address:
- Public key:
