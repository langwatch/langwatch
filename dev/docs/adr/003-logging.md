# ADR-003: Logging and Tracing Infrastructure

## Status

Accepted

## Context

LangWatch needs observability to debug production issues and correlate requests across services. We need to decide on a logging library, context propagation strategy, and integration with distributed tracing.

## Decision

### Logging Library: Pino

We use **Pino** for structured JSON logging:

- **Console output**: INFO+ by default (dev and prod), via pino-pretty in dev.
  When the local observability stack is up, haven mutes the console to WARN+
  (`LOG_CONSOLE_LEVEL`, overridable via `LW_OBS_CONSOLE_LEVEL`) because the full
  `info`/`debug` stream is now in Grafana; it also drops the business-context
  fields (org/project/user) from each pretty line, keeping only `trace_id`/
  `span_id` for correlation. See ADR-042.
- **OTel export**: DEBUG+ when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured
- **Context injection**: Automatic via pino's `mixin` option

### Context Propagation: AsyncLocalStorage

We use Node.js **AsyncLocalStorage** to propagate request context across async boundaries. Middleware (Hono, tRPC, Pages Router) creates a `RequestContext` and calls `runWithContext()`. All downstream code — loggers, services, queue jobs — reads context automatically via `getCurrentContext()` without manual parameter passing.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `context` | `packages/telemetry/src/context/` | Core context management and logger registration |
| `logger.ts` | `packages/telemetry/src/` | Isomorphic logger factory with context injection |
| `loggerMiddleware` | `src/app/api/middleware/` | Hono HTTP context setup |

### RequestContext Shape

```typescript
interface RequestContext {
  organizationId?: string;
  projectId?: string;
  userId?: string;
}
```

Trace and span IDs come directly from the active OpenTelemetry context; ALS
stores only the business context.

### Background Job Context

Jobs receive context via payload metadata:

```typescript
// When creating a job
const metadata = getJobContextMetadata();
await queue.add('job-name', { ...data, __context: metadata });

// When processing a job
const ctx = createContextFromJobData(job.data.__context);
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
- **Explicit server boundary**: Node context and trace helpers use package subpaths so the browser-safe root never loads OpenTelemetry or `node:async_hooks`

## Related

- [Logging Best Practices](../best_practices/logging-and-tracing.md)
