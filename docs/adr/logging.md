# Logging

## Decision

Structured logging with trace correlation because:
- **Debugging** - Trace requests across services
- **Compliance** - Audit trail for sensitive operations
- **Alerting** - Structured data enables automated monitoring

## Rules (Reviewer: Enforce These)

1. **Never log secrets** - API keys, tokens, passwords
2. **Never log PII** - Emails, names (unless explicit business requirement)
3. **Always include traceId** - For request correlation
4. **Use structured format** - `logger.info("msg", { key: value })`, not string interpolation
