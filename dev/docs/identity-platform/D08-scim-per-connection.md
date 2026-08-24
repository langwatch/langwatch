# D08 — SCIM per-connection + grants integration

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D05 (connection-scoped tokens) + **authz precondition checklist (hard)** · Flag: `SCIM_V2_GRANTS`

# Overview

SCIM stops writing membership tables directly. Tokens become scoped per SSO connection, a `(connectionId, externalId) → userId` mapping gives IdP-stable identity per connection, and every membership consequence flows through `grants.*` — SCIM becomes a command/event producer in the identity pipeline. De-enroll is a replayable event with a proven postcondition: no effective permissions remain.

# Requirements

- `ScimToken.connectionId` (issued in D05); tokens are per-connection — a token for connection A cannot write org B.
- IdP-stable identity is **per connection**: a `(connectionId, externalId) → userId` mapping with a composite uniqueness constraint on `(connectionId, externalId)` (survives email changes; one user may carry different `externalId`s across connections). Every SCIM lookup and write keys on both — never on `externalId` alone.
- `ScimSync` aggregate + `scim_sync_state` projection:

```mermaid
stateDiagram-v2
    [*] --> TOKEN_ISSUED : token minted (connection-scoped)
    TOKEN_ISSUED --> SYNCING : first push
    SYNCING --> ERROR : push/apply failed
    ERROR --> SYNCING : retry (backoff)
    SYNCING --> REVOKED : revoke / connection torn down
    ERROR --> REVOKED : revoke
```

- All membership writes via `grants.attach` / `grants.offboard` — no direct `OrganizationUser`/`RoleBinding` writes. De-enroll calls `grants.offboard`; the empty-proof postcondition is asserted in an integration test.
- Failed applies are visible dead-letters via the pipeline's existing process-manager mechanism (handlers zod-parse, retry idempotently, `retryable: false` retires visibly — nothing new is introduced; the pipeline itself has no outbox, ADR-101/R13), never silent drift.
- Group → role-binding mapping UI stays; its writes also go through `grants.attach`. SCIM-managed group provenance guards (no rename/member edits outside SCIM) survive.
- Connection teardown revokes its SCIM tokens (lifecycle event → PM intent).

# Data structures

```text
ScimToken
  + connectionId  string  FK → sso_connections; the token's entire write authority
ScimExternalId           new mapping table: (connectionId, externalId) → userId
  connectionId    string  FK → sso_connections
  externalId      string  the IdP's stable identifier (survives email changes)
  userId          string  FK → User
  @@unique([connectionId, externalId])
```

`ScimSync` events (`tenantId = organizationId`, `aggregateId = scimSyncId`; SCIM payload PII stays out per the D01 rule — user references are `userId`/`externalId`):

```jsonc
// lw.identity.scim_user_pushed    { scimSyncId, connectionId, userId, externalId, op: "create" | "update" | "deactivate" }
// lw.identity.scim_group_mapped   { scimSyncId, connectionId, groupId, roleKey }
// lw.identity.scim_apply_failed   { scimSyncId, connectionId, op, errorCode }       → dead-letter evidence
// lw.identity.scim_token_revoked  { scimSyncId, connectionId, cause: "revoke" | "teardown" }
```

Membership consequences are grants-ledger events, not SCIM events: the reconciler dispatches `grants.attach`/`grants.offboard`, whose `grant_attached`/`grant_revoked` facts carry `source: "scim"` and `actor: { "type": "system", "id": "<connectionId>" }` — the shape the ledger already accommodates.

# Out of Scope

- SCIM protocol surface changes (v2 Users+Groups already complete). Seat/billing classification (license system owns it; lite-member-as-role was the authz program).

# Research

- Today: `platform/app/ee/scim/` — full SCIM v2 at `/api/scim/v2`, per-org bearer tokens, direct writes with unconditional MEMBER role, Auth0 log-stream webhook (dies at D10; customers repoint at D09).
- Doctrine anchor: `specs/event-sourcing/pipeline-model.feature` (pipelines own their commands/events/projections); content-boundary precedent ADR-052.
- Corpus-audit spec impacts: `scim-group-mapping.feature` — 20/24 scenarios `@unimplemented`; amend deprovisioning (:170-178) from "direct RoleBinding records removed" to the grants-offboard framing now, while it's cheap. `groups-rest-api.feature` — provenance guards (:83-86, :101-104, :129-132, :149-152) are anchors that survive. `specs/organizations/scim-tokens-rest-api.feature` — the REST mint/revoke contract gains connection scoping (create names a connection); the secret-shown-once and no-secrets-in-list anchors survive.

# Technical Plan

1. `ScimToken.connectionId` migration + backfill (org's first connection; D05 issues new tokens scoped).
2. `ScimExternalId` mapping migration (composite-unique on `(connectionId, externalId)`) + SCIM payload mapping keyed on both.
3. ScimSync aggregate, events, projection; SCIM endpoints become command producers (same external API).
4. Process manager: de-enroll → `grants.offboard` with postcondition check; retry with backoff; dead-letter visibility in the ops surface.
5. Group mapping UI write path repointed to `grants.attach`.
6. Amend `scim-group-mapping.feature` and `scim-tokens-rest-api.feature`; integration test asserting the offboard postcondition.

# Exit gate / rollback

- **Exit:** push/group/deactivate round-trip; token scoping enforced (cross-connection write rejected); offboard postcondition asserted in integration test; dead-letters visible.
- **Rollback:** legacy direct-write path behind `SCIM_V2_GRANTS` flag until bake completes.

# Security Concerns

- Token scope: per-connection; cross-org writes impossible by construction.
- De-enroll is the highest-stakes SCIM operation — replayable event + proven postcondition + visible failure, never silent.
- SCIM events carry ids/externalIds and the email where the fact is about one, never tokens or secrets (D01 payload rules).

# Open Questions

- None specific. (Role-mapping semantics for the unified engine — e.g. unconditional-MEMBER replacement — were settled by the authz program's roleKey model; SCIM maps seat → roleKey per that program.)
