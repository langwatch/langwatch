# ADR-090: Redis is an owned client, not a module singleton

**Date:** 2026-08-10

**Status:** Accepted

**Related:** ADR-070 (modular package architecture — this is one bounded-context package cut from it), ADR-076 (single pnpm workspace), ADR-004 (dev environment — `REDIS_DB_INDEX` worktree isolation). Applies to Redis the rule `@langwatch/clickhouse-client` already applies to ClickHouse.

---

## Context

`platform/app/src/server/redis.ts` opened a live connection **as an import side effect**:

```ts
export let connection: IORedis | Cluster | undefined;

if (!isBuildOrNoRedis) {
  connection = new IORedis(env.REDIS_URL ?? "", { ... });   // ← at module load
}
```

Importing that module — from a route, a service, a test, or any file the browser
bundle happened to reach — opened a socket. Three costs followed from that one
property, and every one of them is a symptom rather than a separate problem.

**It needed an escape hatch to survive its own environments.** Because the work
happened at import time, the module could not be allowed to run during a Next
build, a vitest run, or in jsdom. So it grew `shouldSkipRedis()`, reading raw
`process.env` (`NEXT_PHASE`, `BUILD_TIME`, `SKIP_REDIS`) and sniffing
`typeof window !== "undefined"` — deliberately bypassing `@t3-oss/env`
validation, because validated env access *itself* threw when reached from the
wrong context. `vitest.config.ts` sets `BUILD_TIME: "1"` globally for exactly
this reason, with a comment pointing at the file. None of those branches
describe a product requirement. They exist to stop an import from connecting.

**The app-layer could not use it, so the process held two connections.** The
composition root builds its own through `clients/redis.factory.ts`. That factory
carried a comment asking callers to keep its `db` index in sync with the
singleton by hand, "or the `REDIS_DB_INDEX` dev isolation becomes a split
brain" — a correctness constraint with nothing enforcing it. Every process ran
two clients against the same server, with two lifecycles, and only one of them
was closed by `App.close()`.

**Tests mocked a module to stop it connecting.** Roughly twenty test files carry
`vi.mock("~/server/redis", () => ({ connection: undefined }))`. Almost none of
them are about Redis; they mock it because constructing the unit under test
would otherwise construct a Redis client.

```text
BEFORE — two owners, one of them implicit

  any import ──▶ server/redis.ts ──▶ [ IORedis ]      ← created at module load
                      │                               ← guarded by BUILD_TIME /
                      │                                 SKIP_REDIS / typeof window
                      └── shouldSkipRedis()

  presets.ts ──▶ clients/redis.factory.ts ──▶ [ IORedis ]   ← the App's own
                                                              second connection
                                                              db index synced by hand

AFTER — one owner, explicit

  @langwatch/redis-client   (pure: config + factory + readiness, no side effects)
        │
        ▼
  presets.ts  ──creates──▶ [ IORedis ]  ──▶ App.redis  ──closed by App.close()
                                              │
                    ┌─────────────────────────┴─────────────────────┐
                    ▼                                               ▼
            injected into services                        getApp().redis
            (constructor / options)                       (resolved when the
            repositories, dispatchers                      handler RUNS)
```

## Decision

**We will treat Redis exactly as we treat ClickHouse: a client the composition
root owns and hands out. No module in the platform will hold a connection at
module scope.**

Three parts:

1. **`@langwatch/redis-client` — a pure package.** It holds configuration
   resolution, the connection factory, and the readiness probe. It reads no
   ambient environment; the caller supplies config. Importing it creates
   nothing. It absorbs `clients/redis.factory.ts`, `redis-db-index.ts`, and the
   connection/readiness logic of `server/redis.ts`.

2. **The App owns the one connection.** `presets.ts` already created it; it is
   now exposed as `getApp().redis` (`Redis | Cluster | null`) and registered as
   a graceful closeable. `src/server/redis.ts` is deleted.

3. **Consumers reach it by injection or from the App.** A service or repository
   takes its connection as a constructor/options dependency — most already do,
   via `import type { Redis } from "ioredis"`. A route or router that cannot be
   injected calls `getApp().redis` **inside the handler**, never at module
   scope. `null` keeps meaning "no Redis configured", so existing degradation
   paths are unchanged.

   Reading Redis is `getApp().redis`, never the `globalForApp` singleton
   directly. The difference is what happens before boot completes: `getApp()`
   raises, the global answers `null`. Raising is what we want nearly everywhere
   — a handler that needs Redis and has no App has a boot-order bug, and it
   should say so rather than quietly take a lesser branch.

   The exception is a consumer whose *documented contract* is to degrade, and
   for those there is a named accessor, `tryGetApp(): App | null`.

   That exception turned out to cover most Redis consumers, and the reason is
   worth stating plainly: **Redis has always been optional in this codebase**.
   Nearly every consumer already opens with `if (!redis)` and has a documented
   fallback — an in-memory counter, a skipped dedupe, an open-failed rate limit,
   a 503, "run state not stored". For those, "no App" and "no Redis" are the
   same condition, and raising on the first turns a path built to survive
   exactly this into a crash. We measured both halves of that: strict `getApp()`
   in `TtlCache` alone broke 171 unit tests across 23 files, and applying it to
   the route-level consumers turned integration tests into 500s in suites that
   have nothing to do with Redis.

   What keeps this from hollowing out the decision is that the invariant worth
   protecting is not "reads raise without an App" — it is **one owner, no
   module-level connection, nothing constructed at import**. That is preserved
   whole, and the two source guards enforce it. The accessor choice only decides
   what a consumer does when there is no App, and for a consumer that already
   branches on absence the honest answer is: the same thing it does without
   Redis.

   `getApp()` is kept where doing less is not a degraded success but a wrong
   answer — `revokeSessions`, where skipping the Redis clear leaves a revoked
   user logged in for up to the session TTL — and on the boot probe, which runs
   after `initializeApp` by construction.

   `task.ts` also uses the accessor, for a different question: "did this task
   build an App?", asked in order to close it. That is not a Redis read at all.

The readiness probe throws rather than exiting. `verifyRedisReady()`'s
`process.exit(1)` moves to `start.ts`, the one caller that owns the process
lifecycle; `startWorkers()` keeps handling the rejection itself so a Redis
hiccup during worker boot cannot take a serving web process down with it.

## Rationale / Trade-offs

The alternative was to keep the singleton and make it lazy — a `getConnection()`
that memoises. That removes the import side effect but keeps the second owner,
keeps the hand-synced `db` index, and keeps a piece of global mutable state that
tests must reset between files. It fixes the symptom that hurts most and leaves
the structure that produced it.

Making the App the sole owner costs something real: `getApp()` throws before
`initializeApp()`, so any consumer resolving Redis at module scope now fails
loudly instead of quietly receiving `undefined`. That is the trade we want — it
converts a boot-order bug that used to surface as a silent no-op into an
immediate error — but it does mean each call site had to move its resolution
into the function that uses it. `better-auth` was the sharp edge: it decides
whether to configure `secondaryStorage` at module scope, from whether a
connection exists. That decision is now made from *configuration*
(`isRedisConfigured`, a pure predicate over supplied env) while the connection
itself is resolved lazily inside the storage callbacks, which preserves the
existing behaviour exactly without needing a live client at module load.

We keep `null` rather than introducing a null-object client. Every existing
consumer already branches on absence, and those branches encode real product
decisions (fall back to an in-memory counter, skip dedupe, serve uncached). A
null object would hide which of those paths a deployment is actually on.

## Consequences

The browser bundle can no longer reach a Redis client through an accidental
import chain, and no build, test, or jsdom run connects to anything. The
`BUILD_TIME` / `SKIP_REDIS` / `typeof window` guards are deleted rather than
relocated — with no work at import time there is nothing left to guard. Tests
that mocked `~/server/redis` to keep it quiet no longer need to mock anything;
tests that genuinely exercise Redis inject a connection or an in-memory double.

Each process now holds one connection instead of two, closed once by
`App.close()`, and `REDIS_DB_INDEX` worktree isolation is applied in exactly one
place, so it can no longer split-brain.

The cost is a wider blast radius on the way in: every consumer changed, and any
future consumer must now decide where it sits — injected dependency, or
`getApp()` at call time. That is a question we want asked. Note also that
`getApp().redis` inside a handler is a service-locator lookup, not injection; it
is the pragmatic option for route modules that have no constructor, and
injection remains the default everywhere a seam exists.

## References

- Spec: `specs/server/redis-client-ownership.feature`
- Prior art: `packages/clickhouse-client`, reached via `getApp().clickhouse`
- Related ADRs: ADR-070 (modular package architecture), ADR-076 (single pnpm workspace), ADR-004 (dev environment / `REDIS_DB_INDEX`)
