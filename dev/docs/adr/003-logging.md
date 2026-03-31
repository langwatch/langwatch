# ADR-003: Logging and Tracing Infrastructure

## Status

Accepted

## Context

LangWatch needs observability to debug production issues and correlate requests across services. We need to decide on a logging library, context propagation strategy, and integration with distributed tracing.

## Decision

### Logging Library: Pino

We use **Pino** for structured JSON logging:

- **Console output**: WARN+ in development (via pino-pretty), INFO+ in production
- **OTel export**: DEBUG+ when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured
- **Context injection**: Automatic via pino's `mixin` option

### Context Propagation: AsyncLocalStorage

We use Node.js **AsyncLocalStorage** to propagate request context across async boundaries. Middleware (Hono, tRPC, Pages Router) creates a `RequestContext` and calls `runWithContext()`. All downstream code — loggers, services, queue jobs — reads context automatically via `getCurrentContext()` without manual parameter passing.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `asyncContext.ts` | `src/server/context/` | Core context management |
| `contextProvider.ts` | `src/server/context/` | Decoupled registry for logger |
| `logger.ts` | `src/utils/` | Logger factory with context injection |
| `loggerMiddleware` | `src/app/api/middleware/` | Hono HTTP context setup |
| `withPagesRouterLogger` | `src/middleware/` | Next.js Pages Router wrapper |

### RequestContext Shape

```typescript
interface RequestContext {
  traceId: string;      // 32-char hex (OTel-compatible)
  spanId: string;       // 16-char hex (OTel-compatible)
  organizationId?: string;
  projectId?: string;
  userId?: string;
}
```

### Background Job Context

Jobs receive context via payload metadata:

```typescript
// When creating a job
const metadata = getJobContextMetadata();
await queue.add('job-name', { ...data, _context: metadata });

// When processing a job
const ctx = createContextFromJobData(job.data._context);
runWithContext(ctx, async () => {
  // Context is available here
});
```

## Consequences

### Positive

- **Automatic correlation**: All logs within a request include traceId for easy filtering
- **No manual spreading**: Developers don't pass context to log calls
- **OTel integration**: Works with OpenTelemetry for distributed tracing
- **Type safety**: Strong typing for context fields

### Negative

- **AsyncLocalStorage overhead**: Small performance cost for context storage
- **Module initialization order**: `asyncContext.ts` must be imported before `logger.ts` to register the provider

## Related

- [Logging Best Practices](../best_practices/logging-and-tracing.md)
