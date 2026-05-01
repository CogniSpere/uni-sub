# Canonical Axes Modules

This directory contains the ten canonical axes that define the WCO v2 ecosystem. Each axis is an independent ES module that exposes a standardized API via the Registry.

## The Ten Axes

### 1. Truth Axis (`truth-axis.js`)
**Question:** What is valid, and how is it structured?

Manages schemas, validation, migrations, and entity relationships. This is the reality layer.

**Key APIs:**
- `registerSchema()` — register a schema with validation
- `validate()` — validate an object against a schema
- `migrate()` — run schema migrations
- `storeEntity()` / `getEntity()` — persist and retrieve entities
- `linkEntities()` — create relationships between entities

---

### 2. Identity Axis (`identity-axis.js`)
**Question:** Who/what is acting?

Manages pseudonymous IDs, entity linking, and key ownership. Everything else depends on this being stable.

**Key APIs:**
- `resolveId()` — normalize any input to a canonical actor ID
- `linkEntities()` — alias multiple identifiers to one actor
- `registerPublicKey()` / `getKeyOwner()` — key ownership tracking
- `verifyKeyOwnership()` — verify signature
- `markVerified()` — mark actor as verified

---

### 3. Trust Axis (`trust-axis.js`)
**Question:** How much should anything be believed?

Manages reputation scoring, verification levels, and historical behaviour tracking. Feeds governance, moderation, and federation filtering.

**Key APIs:**
- `recordEvent()` — record a trust-affecting event (positive/negative/neutral)
- `score()` — compute current trust score (0..1)
- `setVerificationLevel()` — mark actor as verified/trusted/core
- `getReputation()` — full reputation record
- `leaderboard()` — top trusted actors

---

### 4. Governance Axis (`governance-axis.js`)
**Question:** How are decisions made and changed?

Manages proposals, voting, and delegation. Defines how the system evolves.

**Key APIs:**
- `propose()` — create a proposal
- `vote()` — cast a vote
- `tally()` — tally votes and determine outcome
- `delegateVote()` / `revokeDelegation()` — voting delegation
- `listProposals()` — query active/closed proposals

---

### 5. Coordination Axis (`coordination-axis.js`)
**Question:** How do independent nodes relate and sync?

Manages federation, peer discovery, CRDTs, and cross-node synchronization. This is the network topology + agreement layer.

**Key APIs:**
- `registerPeer()` / `discoverPeers()` — peer management
- `syncWithPeer()` — initiate sync with remote node
- `setCRDT()` / `getCRDT()` / `mergeCRDT()` — CRDT operations
- `getManifest()` — federation capabilities

---

### 6. Incentive Axis (`incentive-axis.js`)
**Question:** Why do actors behave one way vs another?

Manages gamification, badges, rewards, and token economics. Shapes participation and contribution quality.

**Key APIs:**
- `awardBadge()` / `addPoints()` — delegate to gamification module
- `grantReward()` — distribute points/badges/tokens
- `burnTokens()` / `transferTokens()` — token economics
- `getIncentiveRecord()` — query actor's incentives
- `leaderboard()` — top contributors

---

### 7. Control Axis (`control-axis.js`)
**Question:** What is allowed, restricted, or enforced?

Manages access control, policies, moderation, and appeals. Where rules become action.

**Key APIs:**
- `grantPermission()` / `revokePermission()` — RBAC
- `checkPermission()` — access check
- `registerPolicy()` — register enforcement policies
- `enforceAction()` — apply moderation action (mute, block, delete)
- `submitAppeal()` / `reviewAppeal()` — appeals process

---

### 8. Privacy Axis (`privacy-axis.js`)
**Question:** Who gets to see what?

Manages data visibility, selective sharing, and encryption boundaries. Often conflicts with federation + analytics.

**Key APIs:**
- `setVisibilityPolicy()` — set public/private/restricted
- `redactForViewer()` — filter sensitive fields
- `encryptForRecipients()` — encrypt data
- `grantAccess()` / `revokeAccess()` — selective sharing
- `canDecrypt()` — check decryption permission

---

### 9. Execution Axis (`execution-axis.js`)
**Question:** How does the system actually do things?

Manages adapters, pipelines, and the eventbus. This is the mechanical layer.

**Key APIs:**
- `registerAdapter()` / `runAdapter()` — adapter lifecycle
- `registerPipeline()` / `runPipeline()` — orchestration
- `subscribe()` / `publishEvent()` — event system
- `getExecutionLog()` — execution history

---

### 10. Observability Axis (`observability-axis.js`)
**Question:** What is happening, and can we trust the system state?

Manages audit logs, metrics, tracing, and debugging. Critical for governance legitimacy + federation sanity.

**Key APIs:**
- `audit()` — record audit event
- `getAuditLog()` — query with filters
- `metrics()` — record metric value
- `getMetrics()` — aggregate statistics
- `trace()` / `getTrace()` — distributed tracing
- `getHealthSnapshot()` — system status

---

## Usage

### In `module-loader-v2.js`

Add these modules to the default module list:

```javascript
const defaultModules = [
  "./modules/truth-axis.js",
  "./modules/identity-axis.js",
  "./modules/trust-axis.js",
  "./modules/governance-axis.js",
  "./modules/coordination-axis.js",
  "./modules/incentive-axis.js",
  "./modules/control-axis.js",
  "./modules/privacy-axis.js",
  "./modules/execution-axis.js",
  "./modules/observability-axis.js"
];
```

### Calling an Axis API

```javascript
import { Registry } from "../registry.js";

const trustApi = Registry.get("trust-axis-api");
const score = await trustApi.score("actor_123");
```

## Versioning

All axes export `version = "0.1.0"` per the "C. Modules must be versioned" rule. Update this during development.

## State Management

Each axis maintains its own `state` object at module scope. This is sufficient for browser/extension contexts. For persistence, integrate with the `storage-helpers.js` pattern or a backend store.

## Integration with Gamification

The `incentive-axis` delegates badge/points operations to the `gamification-api` if present. This keeps gamification as the source of truth while allowing other modules to award incentives uniformly.
