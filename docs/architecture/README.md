# Architecture Decisions

Why we built things the way we did. Code is self-documenting for _how_.

| Decision | Rationale | Rules |
|----------|-----------|-------|
| [RBAC](./rbac.md) | Multi-tenant isolation | Always use new system, never raw queries |
| [Event Sourcing](./event-sourcing.md) | Audit trail + rebuild capability | TenantId required, events immutable |
| [Logging](./logging.md) | Debugging + compliance | Never log PII/secrets |

N+1 optimization removed - it's a standard pattern, not a project decision.
