# Event Sourcing

## Overview

Event-driven system for traces, evaluations, and other aggregates.

## Key Directories

- `src/server/event-sourcing/library/` - Core abstractions (domain-agnostic)
- `src/server/event-sourcing/runtime/` - Runtime implementation

## Core Concepts

| Concept | Description | Key File |
|---------|-------------|----------|
| Event | Immutable fact with `tenantId`, `aggregateId`, `type`, `data` | `library/event.ts` |
| Projection | Computed view built from events | `library/projection.ts` |
| EventStore | Persists/queries events (partitioned by tenant) | `library/store.ts` |
| EventSourcingService | Orchestrates rebuild pipeline | `library/service.ts` |

## Security

- **TenantId is branded type** - not plain string, enforces isolation
- Always partition by `tenantId + aggregateType`
- Use context-aware read/write operations

## Patterns

- Events are immutable facts, projections are derived
- Rebuild projections from events when logic changes
- Use EventStream for automatic ordering
