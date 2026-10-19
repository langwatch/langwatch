---
name: platform-primitives
description: "The shared building blocks module code uses instead of rolling its own: ids (@langwatch/ksuid generate, strict KSUIDs, never derived from another id), time (@langwatch/time nowInstant and Temporal, no new Date or Date.now), logging (createLogger, no console), errors (contract HandledError subclasses vs a plain Error), config and secrets (Config.define, Secret.load, no process.env), outbound calls (SSRF-validated egress: createSsrfUrlValidator, fetchValidatedDestination), Redis and rate limits (through a repository; @langwatch/limiter), and plans, entitlements vs permissions. Use when someone says 'generate an id', 'new id', 'randomUUID', 'nanoid', 'current time', 'Date.now', 'new Date', 'Temporal', 'logger', 'console.log', 'throw an error', 'HandledError or Error', 'read an env var', 'process.env', 'add a secret', 'Secret.load', 'call an external URL', 'SSRF', 'webhook destination', 'fetch with a timeout', 'rate limit', 'redis cache', 'cache TTL', 'share a minted key across servers', 'mintOnce', 'sealed token in Redis', 'plan limit', or 'entitlement'."
user-invocable: true
---

# Platform primitives

One way for each. Record: `dev/docs/ARCHITECTURE.md` section 3.2 (ids, the no-members homes), section 6 (config and
secrets), section 7 (Redis keys expire), section 12 (errors). Lint messages carry their own fix; this page says which
package and shows a real call site. Not here: authorising a request (`authorization`), declaring a transport
(`api-transports`), the module's error classes (`contract`).

## Ids

```ts
import { generate } from "@langwatch/ksuid";
const agentId = generate("agent").toString(); // modules/agent/process/src/rules/agent-id.rules.ts:12
```

- A new record's id is a KSUID `<resource>_<ksuid>`; the resource is the owning subject's name without hyphens and
  without an underscore (`slackintegration`). Known prefixes: `packages/ksuid/src/resources.ts`.
- Ids are strict: mint a fresh one. Never build one id out of another (`project_<team ksuid part>` was refused,
  Alex 2026-10-09) and never derive an id from content.
- Ids minted before (nanoid, uuid) stay as they are and stay accepted. New code does not call `randomUUID()` or `nanoid`
  for a record id; `langwatch/id-generation-origin` refuses it.
- `ksuid` is the one public function that takes positional arguments; it is a cross-language wire (record section 3.2).
- An event id is a k-sortable cursor, compared by decoded seconds, never as plain strings (see `eventing-and-worker`).

## Time

`@langwatch/time` is the one clock. `nowInstant()` for now, `Temporal` for arithmetic, `toDate` / `fromDate` only where a
boundary (Prisma, a driver) hands or wants a `Date`, `nextCronFireAt` for schedules, `formatDistance*` for relative text.
Do not write `new Date(x)` or `Date.now()` in module code (`langwatch/temporal-only` names the fix).
A service that needs a different clock takes `now: () => Instant` as an option, and memory twins take one too
(record section 15 homes). Pure `rules/` take the instant as an argument; they never read the clock.
Spec: `specs/dependencies/temporal-time.feature`.

## Logging

`const logger = createLogger("langwatch:<module>[:<part>]")` from `@langwatch/observability`, one per file, at module
scope (`modules/webhook/process/src/app/webhook.app.ts:103`). No `console.*`. No `processName`; refusals name the module
and the role. Never log a secret, a credential header or a token; `Secret` values print masked.

## Errors

- A `HandledError` subclass, declared in the module's contract, when the cause is known and the caller can act.
  `message` is customer-safe. Register the `code` in `packages/handled-error/src/app-codes.ts`, its copy in
  `presentation.ts`, its tips in `remediation.ts` (example: `modules/webhook/contract/src/webhook.errors.ts:13`).
- Everything else is a plain `Error`: it reaches the boundary as "unknown" plus a trace id, on purpose.
- A 5xx subclass sets `fault` explicitly, or it becomes `presumed_platform`. Tests assert on `code`, never prose.
- A service throws a `HandledError`, never a `TRPCError`.

## Config and secrets

- A deployment fact is a `Config.define((c) => ({ x: c.env("NAME", zodSchema) }))` leaf in the module's contract
  `<name>.config.ts` (`modules/github/contract/src/github.config.ts`). The module class attaches it as `static config`.
- A secret is a `Secret.load("ID")` handle, never a config field. `create()` and registries resolve it through
  `secrets.into(...)`. One identifier per secret; a second claim is refused (record section 6).
- Nothing outside an app's `src/config.ts` reads `process.env` (`langwatch/environment-boundaries`).
  A module takes the parsed value as an argument.

## Outbound calls (egress)

A request to an address a customer supplies goes through `@langwatch/egress`: `createSsrfUrlValidator({ blockLocal,
allowedHosts })` judges the URL, `fetchValidatedDestination(validated, init, tls)` is the only way to contact it (the name is
resolved once and pinned, redirects are never followed on the receiver's say-so). Metadata hosts are refused always.
Example: `modules/webhook/process/src/rules/webhook-url-policy.rules.ts` and
`modules/webhook/process/src/channels/http/http.destination.channel.ts`. The TLS policy and address policy come from
the composition root; the package reads no environment. Every fetch also carries a timeout (`langwatch/require-fetch-timeout`).
Self-hosted calls leave through the proxy helpers in the same package.

## Redis and rate limits

- A module never holds a Redis client. A repository takes the store's `redis` or `rateLimiter` in `create(stores)`
  and wraps it: `modules/trace/process/src/repositories/redis/redis.trace-rate-limit.repository.ts`, with a memory twin
  beside it (`memory.*`).
- Every key a cache repository writes expires in the same atomic command (`SET ... EX`, `SETEX`, a Lua script); at most
  60 s for anything that authorises, 5 minutes for folds and analytics. A test refuses a write without a TTL
  (`packages/architecture-enforcer/tests/redis-cache-ttl.unit.test.ts`).
- A credential every server hands out (a run's key, a project's sandbox key) is minted once and shared sealed:
  the service calls `mintOnce({ store, address: { tenantId, contentKey }, mint, isReady })` from
  `@langwatch/secrets/shared-credential` with its repository as `store`. The live repository is a
  `RedisSharedCredentialStore` (`@langwatch/redis-client/shared-credential`; prefix, `redis`, the stores'
  `encryption`) built in `repositories/redis/`; `MemorySharedCredentialStore` is its twin. One caller claims and
  mints, the rest wait up to 10 s for the same value, then answer pending. Never a per-process map, never a
  table of pending mints (record section 7; `modules/api-key/process/src/services/run-key-mint.service.ts`).
- `@langwatch/limiter` holds bounded concurrency (`ConcurrencyLimiter`, sheds when the wait queue is full) and the
  per-tenant ClickHouse statement limiter. A request-rate window is the store's `rateLimiter`, not this package.

## Plans, entitlement, permission

A fixed bound known before any organisation (a body limit, a default page size) reads `@langwatch/plans` directly. A bound
that varies by organisation asks `EntitlementApi.requestBound` / `assertWithinUsageLimit`. Whether the install has a thing
at all is the owning module's own answer from its config. Whether this person may is a permission (`authorization`).
Routes stay mounted and refuse per organisation; a core caller does not re-check what entitlement decided.
