# ADR-003: Logging and Tracing Infrastructure

## Status

Accepted

## Context

LangWatch needs comprehensive observability to debug production issues, understand system behavior, and correlate requests across services. We need to decide:

1. What logging library to use
2. How to propagate request context across async boundaries
3. How to integrate with distributed tracing (OpenTelemetry)
4. How to structure logs for both development and production

## Decision

### Logging Library: Pino

We use **Pino** for structured JSON logging with the following configuration:

- **Console output**: WARN+ in development (via pino-pretty), INFO+ in production
- **OTel export**: DEBUG+ when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured
- **Context injection**: Automatic via pino's `mixin` option

### Context Propagation: AsyncLocalStorage

We use Node.js **AsyncLocalStorage** to propagate request context across async boundaries:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Request Flow                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   HTTP Request                                                       │
│       │                                                              │
│       ▼                                                              │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │  Middleware (Hono / Next.js / tRPC)                       │     │
│   │  - Creates RequestContext (traceId, spanId, org, proj, user)    │
│   │  - Calls runWithContext(ctx, handler)                     │     │
│   └───────────────────────────────────────────────────────────┘     │
│       │                                                              │
│       ▼                                                              │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │  AsyncLocalStorage                                         │     │
│   │  - Stores context in async continuation                   │     │
│   └───────────────────────────────────────────────────────────┘     │
│       │                                                              │
│       ├──────────┬──────────┬──────────┐                            │
│       ▼          ▼          ▼          ▼                            │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                       │
│   │ Logger │ │ tRPC   │ │ Queue  │ │  DB    │                       │
│   │ mixin  │ │ proc   │ │ job    │ │ query  │                       │
│   └────────┘ └────────┘ └────────┘ └────────┘                       │
│       │          │          │          │                            │
│       ▼          ▼          ▼          ▼                            │
│   (context automatically available via getCurrentContext())         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

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

- **Automatic correlation**: All logs within a request automatically include traceId, enabling easy filtering
- **No manual spreading**: Developers don't need to manually pass context to log calls
- **OTel integration**: Works with OpenTelemetry for distributed tracing
- **Type safety**: Strong typing for context fields

### Negative

- **AsyncLocalStorage overhead**: Small performance cost for context storage
- **Module initialization order**: `asyncContext.ts` must be imported before `logger.ts` to register the provider

## Related

- [Logging Best Practices](../best_practices/logging-and-tracing.md)
- [Pino Documentation](https://getpino.io/)
- [OpenTelemetry JS](https://opentelemetry.io/docs/instrumentation/js/)
