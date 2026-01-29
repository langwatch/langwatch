# Logging and Tracing Best Practices

This guide covers how to use LangWatch's logging and tracing infrastructure effectively.

## Overview

LangWatch uses:
- **Pino** for structured logging
- **AsyncLocalStorage** for request context propagation
- **OpenTelemetry** for distributed tracing (optional)

## Creating Loggers

```typescript
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:my-module");

// Use standard pino signature: (object, message)
logger.info({ userId, action: "login" }, "User logged in");
logger.error({ error, requestId }, "Failed to process request");
```

### Logger Options

```typescript
// Disable automatic context injection (rare)
const logger = createLogger("my-module", { disableContext: true });
```

## Log Levels

| Level | When to Use | Console (Dev) | Console (Prod) | OTel |
|-------|-------------|---------------|----------------|------|
| `trace` | Verbose debugging | ❌ | ❌ | ✅ |
| `debug` | Development debugging | ❌ | ❌ | ✅ |
| `info` | Normal operations | ❌ | ✅ | ✅ |
| `warn` | Concerning but not broken | ✅ | ✅ | ✅ |
| `error` | Errors requiring attention | ✅ | ✅ | ✅ |
| `fatal` | Application crash | ✅ | ✅ | ✅ |

Configure via environment:
- `PINO_CONSOLE_LEVEL` - Console output level (default: "warn" dev, "info" prod)
- `PINO_OTEL_LEVEL` - OTel export level (default: "debug")
- `PINO_LOG_LEVEL` - Base logger level (default: "debug")

## Automatic Context Injection

Loggers automatically include request context when available:

```typescript
// Inside a request handler
logger.info({ action: "save" }, "Saving document");
// Output includes: traceId, spanId, organizationId, projectId, userId
```

This works because middleware sets up context via `runWithContext()`.

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

// When enqueuing a job
const metadata = getJobContextMetadata();
await queue.add("process-trace", {
  traceId: data.traceId,
  _context: metadata, // Pass context metadata
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
    // All logs here automatically include the original request's traceId
    logger.info({ jobId: job.id }, "Processing job");
    // ...
  });
});
```

## Updating Context After Authentication

Sometimes you need to add user info after initial context setup:

```typescript
import { updateCurrentContext } from "~/server/context/asyncContext";

// After authentication succeeds
updateCurrentContext({
  userId: session.user.id,
  organizationId: org.id,
  projectId: project.id,
});
```

## Common Patterns

### Error Logging

```typescript
try {
  await riskyOperation();
} catch (error) {
  // Always include error object for stack traces
  logger.error({ error, input }, "Operation failed");
  throw error;
}
```

### Performance Logging

```typescript
const start = Date.now();
try {
  const result = await slowOperation();
  logger.info({ duration: Date.now() - start }, "Operation completed");
  return result;
} catch (error) {
  logger.error({ duration: Date.now() - start, error }, "Operation failed");
  throw error;
}
```

### Conditional Debug Logging

```typescript
// Debug logs go to OTel but not console in dev
logger.debug({ query, params }, "Executing database query");
```

## Anti-Patterns

| Don't | Do |
|-------|-----|
| `logger.info("User " + userId + " logged in")` | `logger.info({ userId }, "User logged in")` |
| `logger.error("Error: " + error.message)` | `logger.error({ error }, "Operation failed")` |
| `logger.info({ password }, "...")` | Never log sensitive data |
| `logger.info("msg", { data })` | `logger.info({ data }, "msg")` |
| `{ ...getLogContext(), ...data }` | Context is automatic via mixin |

## Searching Logs

All logs within a request share the same `traceId`. To find related logs:

```
traceId:"abc123def456..."
```

To find all logs for a user:
```
userId:"user_xyz"
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PINO_LOG_LEVEL` | Base logger level | "debug" |
| `PINO_CONSOLE_LEVEL` | Console output level | "warn" (dev), "info" (prod) |
| `PINO_OTEL_LEVEL` | OTel export level | "debug" |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector endpoint | - |
| `OTEL_SERVICE_NAME` | Service name in traces | "langwatch-backend" |
