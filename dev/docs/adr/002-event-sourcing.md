# ADR-002: Event Sourcing for Traces and Evaluations

**Status:** Superseded by [ADR-007](./007-event-sourcing-architecture.md)

## Context

Traces and evaluations are core data in LangWatch. We need complete audit history for compliance, the ability to recompute analytics when logic changes, and strict tenant isolation.

## Decision

Use event sourcing: store immutable events, derive projections from them.

## Rationale

- **Audit trail** — Complete history of all changes for compliance requirements
- **Rebuild capability** — Can recompute projections when business logic changes without data loss
- **Tenant isolation** — Branded `TenantId` type enforces data boundaries at the type level, not just runtime

Alternative considered: traditional CRUD with soft deletes. Rejected because it doesn't provide true audit history and makes analytics recomputation difficult.

## Consequences

**Rules to follow:**
1. Events are immutable — never modify or delete, only append
2. TenantId is required — use the branded type, never plain strings
3. Partition by tenant — all queries must include tenantId
4. Projections are derived — don't store authoritative data in projections

**Key files:** `src/server/event-sourcing/`
