# Architecture Decision Records (ADRs)

Documenting **why** we made architectural choices. Code documents _how_.

| Decision | Rationale | Rules |
|----------|-----------|-------|
| [RBAC](./rbac.md) | Multi-tenant isolation | Always use new system, never raw queries |
| [Event Sourcing](./event-sourcing.md) | Audit trail + rebuild capability | TenantId required, events immutable |
| [Logging](./logging.md) | Debugging + compliance | Never log PII/secrets |

## Adding an ADR

Create a new file when making a significant architectural decision:
- Focus on **context** and **why**, not implementation details
- Include "Rules (Reviewer: Enforce These)" section
- Keep it brief - link to code for specifics
