# Logging and Tracing

See [ADR-003](../adr/003-logging.md) for architectural decisions.

## Creating Loggers

```typescript
import { createLogger } from "@langwatch/observability";

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

## Background Jobs

### Sending Context to Jobs

```typescript
import { getJobContextMetadata } from "@langwatch/observability/context";

const metadata = getJobContextMetadata();
await queue.add("process-trace", {
  traceId: data.traceId,
  __context: metadata,
});
```

### Restoring Context in Workers

```typescript
import {
  createContextFromJobData,
  runWithContext,
} from "@langwatch/observability/context";

worker.process(async (job) => {
  const ctx = createContextFromJobData(job.data.__context);

  return runWithContext(ctx, async () => {
    logger.info({ jobId: job.id }, "Processing job");
  });
});
```

## Updating Context After Authentication

```typescript
import { updateCurrentContext } from "@langwatch/observability/context";

updateCurrentContext({
  userId: session.user.id,
  organizationId: org.id,
  projectId: project.id,
});
```

## Identifiers Are Logged Raw, On Purpose

`userId`, `organizationId` and `projectId` — along with `traceId` and `spanId` —
go into log lines unredacted. This is a deliberate decision, not an oversight,
and it is not up for renegotiation one pull request at a time.

They are opaque internal identifiers. They are not names, not email addresses,
and not anything a person outside our systems can resolve to a human. What they
_are_ is the only thing that makes a log line attributable: they are how you
filter Loki down to one tenant during an incident, how you answer "did this
customer's request actually reach us", and how a support question becomes a
query instead of a guess. A redacted identifier costs all of that and protects
nothing, because the identifier was never the sensitive part.

So: a review comment asking for these to be hashed, truncated or redacted
should be declined with a link to this section. Automated reviewers flag them
periodically because "id near a logger" pattern-matches to PII; it isn't, here.

What genuinely must never be logged is unchanged, and none of it is an
identifier:

- Credentials of any kind — passwords, API keys, tokens, session cookies,
  signing secrets.
- Customer content — prompt and completion bodies, dataset rows, span
  input/output, anything a customer typed or a model produced.
- Personal data proper — email addresses, names, phone numbers, postal
  addresses. These are what the PII redaction pass exists for; see
  `packages/features/data-privacy/server/src/`.

## Choosing a Level: Who Decides the Outcome

`error` means something bad and final happened. A failure that is about to be
retried is neither, so logging it at `error` is a false positive — and a steady
supply of them is how a team learns to scroll past the one level that was meant
to stop them.

**The rule: a layer that rethrows does not get to claim an outcome it did not
decide. It logs at `warn`. The layer that stops the propagation — the retry
loop out of attempts, the boundary answering the caller — logs at `error`.**

`GroupQueue` is the reference implementation:

```text
repository catch     -> logger.warn  ... then rethrow      every attempt
groupQueue.ts:1641   -> logger.warn  "Job attempt failed, re-staged with backoff"
groupQueue.ts:2320   -> logger.error "Group blocked after exhausted retries"   once, on giving up
```

The log below the retry loop still earns its place — it holds identifiers
(`tenantId`, `evaluationId`, row counts) that the queue never sees. Keep the
context; drop the severity claim.

This is a different axis from the one in
`specs/observability/request-log-cause-and-level.feature`, which levels a
_request_ by fault: customer fault below error, platform fault at error. This
one levels by **finality**. A platform fault that will be retried is still not
final, so fault alone does not settle it.

The inverse is the case people miss. **Work discarded without anything being
thrown gets `error`**, however routine the code path feels: no layer above will
ever see it, so the discarding layer is the last one that can report it.
`ProjectionRegistry.dispatch` dropping events with no router is the worked
example — it sat at `warn` and lost events on every rolling deploy unnoticed.

| Situation                                    | Level                         |
| -------------------------------------------- | ----------------------------- |
| Failed, and this layer rethrows              | `warn`                        |
| Failed, retry scheduled                      | `warn`                        |
| Failed, retries exhausted / gave up          | `error`                       |
| Work silently discarded, nothing thrown      | `error`                       |
| Handled customer fault at a request boundary | `warn` (see the request spec) |

Spec: `specs/observability/retryable-failure-log-level.feature`.

## Anti-Patterns

| Don't                                               | Do                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `logger.error({ error }, "...")` then `throw error` | `logger.warn(...)` then `throw` — the layer that stops the throw logs the error                                   |
| `logger.warn(...)` on a path that discards work     | `logger.error(...)` — nothing above will report the loss                                                          |
| `logger.warn({ error: error.message }, "...")`      | `logger.warn({ error }, "...")` — a bare string under `error` loses the stack and is dropped by the log collector |
| `logger.info("User " + userId + " logged in")`      | `logger.info({ userId }, "User logged in")`                                                                       |
| `logger.error("Error: " + error.message)`           | `logger.error({ error }, "Operation failed")`                                                                     |
| `logger.info({ password, apiKey }, "...")`          | Never log credentials, customer content, or personal data — see above                                             |
| `logger.info({ userId: hash(userId) }, "...")`      | `logger.info({ userId }, "...")` — identifiers go in raw                                                          |
| `logger.info("msg", { data })`                      | `logger.info({ data }, "msg")` — object first in Pino                                                             |
| `{ ...getLogContext(), ...data }`                   | Context is automatic via mixin                                                                                    |

## Environment Variables

| Variable                      | Description                                          | Default         |
| ----------------------------- | ---------------------------------------------------- | --------------- |
| `PINO_LOG_LEVEL`              | Base logger level                                    | "debug"         |
| `LOG_CONSOLE_LEVEL`           | Console output level (`PINO_CONSOLE_LEVEL` fallback) | "info"          |
| `LOG_OTEL_LEVEL`              | OTel export level (`PINO_OTEL_LEVEL` fallback)       | "debug"         |
| `PINO_OTEL_ENABLED`           | Enable OTel log export                               | "false"         |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector endpoint                              | -               |
| `OTEL_SERVICE_NAME`           | Service name in traces                               | "langwatch-app" |
