# Logging and Tracing

See [ADR-003](../adr/003-logging.md) for architectural decisions.

## Creating Loggers

```typescript
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:my-module");

// Pino signature: (object, message)
logger.info({ userId, action: "login" }, "User logged in");
logger.error({ error, requestId }, "Failed to process request");
```

### Logger Options

```typescript
// Disable automatic context injection (rare)
const logger = createLogger("my-module", { disableContext: true });
```

## Automatic Context Injection

Loggers automatically include request context when middleware has set it up:

```typescript
// Inside a request handler
logger.info({ action: "save" }, "Saving document");
// Output includes: traceId, spanId, organizationId, projectId, userId
```

## Setting Up Request Context

### Hono (API Routes)

```typescript
import { loggerMiddleware } from "~/app/api/middleware/logger";

app.use("*", loggerMiddleware());
```

### tRPC Procedures

Context is automatically set up via `loggerMiddleware` in `trpc.ts`.

### Pages Router API Routes

```typescript
import { withPagesRouterLogger } from "~/middleware/pages-router-logger";

export default withPagesRouterLogger(async (req, res) => {
  // Context is available here
});
```

## Background Jobs

### Sending Context to Jobs

```typescript
import { getJobContextMetadata } from "~/server/context/asyncContext";

const metadata = getJobContextMetadata();
await queue.add("process-trace", {
  traceId: data.traceId,
  _context: metadata,
});
```

### Restoring Context in Workers

```typescript
import {
  createContextFromJobData,
  runWithContext,
} from "~/server/context/asyncContext";

worker.process(async (job) => {
  const ctx = createContextFromJobData(job.data._context);

  return runWithContext(ctx, async () => {
    logger.info({ jobId: job.id }, "Processing job");
  });
});
```

## Updating Context After Authentication

```typescript
import { updateCurrentContext } from "~/server/context/asyncContext";

updateCurrentContext({
  userId: session.user.id,
  organizationId: org.id,
  projectId: project.id,
});
```

## Anti-Patterns

| Don't | Do |
|-------|-----|
| `logger.info("User " + userId + " logged in")` | `logger.info({ userId }, "User logged in")` |
| `logger.error("Error: " + error.message)` | `logger.error({ error }, "Operation failed")` |
| `logger.info({ password }, "...")` | Never log sensitive data |
| `logger.info("msg", { data })` | `logger.info({ data }, "msg")` — object first in Pino |
| `{ ...getLogContext(), ...data }` | Context is automatic via mixin |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PINO_LOG_LEVEL` | Base logger level | "debug" |
| `PINO_CONSOLE_LEVEL` | Console output level | "warn" (dev), "info" (prod) |
| `PINO_OTEL_LEVEL` | OTel export level | "debug" |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector endpoint | - |
| `OTEL_SERVICE_NAME` | Service name in traces | "langwatch-backend" |
