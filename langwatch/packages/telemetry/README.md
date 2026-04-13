# @langwatch/telemetry

Logging, context propagation, and OpenTelemetry utilities for LangWatch services.

## Usage

```ts
import { createLogger } from "@langwatch/telemetry";

const logger = createLogger("my-service");
logger.info("hello");
```

`createLogger` is isomorphic — it detects the runtime environment and picks the right backend:

- **Server (Node.js)**: pino with transports (pretty in dev, JSON in prod), optional OTel export, superjson error serialization, and automatic context injection (traceId, spanId, organizationId, projectId, userId via AsyncLocalStorage).
- **Browser**: pino browser mode with `console.*` output.

### Disable context injection

```ts
const logger = createLogger("my-service", { disableContext: true });
```

### Context propagation

```ts
import { runWithContext, getCurrentContext, updateCurrentContext } from "@langwatch/telemetry";

runWithContext({ organizationId: "org-1", projectId: "proj-1" }, () => {
  // All logs within this scope include org/project context
  logger.info("processing request");

  // Update context after auth
  updateCurrentContext({ userId: "user-123" });
});
```

### Trace context

```ts
import { injectTraceContextHeaders, getActiveTraceId } from "@langwatch/telemetry";

// Inject W3C traceparent into outbound request headers
const { headers, traceId } = injectTraceContextHeaders({ headers: {} });
```

### HTTP request logging

```ts
import { logHttpRequest, getStatusCodeFromError } from "@langwatch/telemetry";

logHttpRequest(logger, {
  method: "GET",
  url: "/api/traces",
  statusCode: 200,
  duration: 42,
  userAgent: "curl/8.0",
});
```

## Environment variables (server only)

| Variable | Default | Description |
|---|---|---|
| `PINO_LOG_LEVEL` | `debug` | Base log level |
| `PINO_CONSOLE_LEVEL` | `info` | Console transport level |
| `PINO_OTEL_ENABLED` | `false` | Enable OpenTelemetry log export |
| `PINO_OTEL_LEVEL` | `debug` | OTel transport level |

## Testing

```bash
pnpm test:unit
```
