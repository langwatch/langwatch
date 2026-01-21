# Event Sourcing

## Decision

We use event sourcing for traces and evaluations because:
- **Audit trail** - Complete history of all changes for compliance
- **Rebuild capability** - Can recompute projections when logic changes
- **Tenant isolation** - Branded TenantId enforces data boundaries at type level

## Rules (Reviewer: Enforce These)

1. **Events are immutable** - Never modify or delete events, only append
2. **TenantId is required** - Use the branded type, never plain strings
3. **Partition by tenant** - All queries must include tenantId
4. **Projections are derived** - Don't store authoritative data in projections

## Where to Look

- `src/server/event-sourcing/library/` - Core abstractions
- `src/server/event-sourcing/runtime/` - Runtime implementation
