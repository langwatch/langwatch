# Logging Best Practices

## Structured Logging

Use structured logging with context:
```typescript
logger.info("Processing trace", { traceId, projectId, spanCount });
```

## Log Levels

| Level | Use For |
|-------|---------|
| `error` | Failures requiring attention |
| `warn` | Recoverable issues, deprecations |
| `info` | Key business events, request lifecycle |
| `debug` | Detailed debugging (off in prod) |

## Sensitive Data

Never log:
- API keys, tokens, passwords
- PII (emails, names) unless required
- Full request/response bodies

## Correlation

Include trace IDs for request correlation:
```typescript
logger.info("Operation complete", { traceId: ctx.traceId });
```
