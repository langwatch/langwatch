# ADR-003: Structured Logging with Trace Correlation

**Status:** Accepted

## Context

Distributed services make debugging difficult. We need to trace requests across services, meet compliance requirements for audit trails, and enable automated alerting.

## Decision

Use structured logging with mandatory trace correlation IDs.

## Rationale

- **Debugging** — Trace requests across services using correlation IDs
- **Compliance** — Audit trail for sensitive operations
- **Alerting** — Structured data enables automated monitoring and anomaly detection

Alternative considered: unstructured text logs. Rejected because they're difficult to query and can't be automatically processed for alerting.

## Consequences

**Rules to follow:**
1. Never log secrets — API keys, tokens, passwords
2. Never log PII — emails, names (unless explicit business requirement)
3. Always include traceId — for request correlation
4. Use structured format — `logger.info("msg", { key: value })`, not string interpolation
