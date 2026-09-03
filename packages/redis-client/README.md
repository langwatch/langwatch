# @langwatch/redis-client

Redis as an owned client, never a module singleton
([ADR-093](../../dev/docs/adr/093-redis-is-an-owned-client.md)).

Importing this package **creates nothing**. It reads no `process.env`, opens no
socket, and has no module-level state — a connection exists only because someone
called `connect()`. That is the whole point: the module this replaced built a
live `IORedis` at import time, so any file that reached it, including a browser
bundle or a test, opened a socket by being imported.

## The three services

Collaborators and the logger arrive once at construction; the methods take only
what varies per call. Same idiom as `@langwatch/authz`.

| Service                  | Holds                                            | Answers                                               |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------- |
| `RedisConfigService`     | nothing — pure and stateless, like `AuthzEngine` | `resolve(env)`, `isConfigured(env)`                   |
| `RedisConnectionService` | a config service + the logger for what it builds | `connect(env)`, `connectStandalone({ url, dbIndex })` |
| `RedisReadinessService`  | a logger                                         | `ping({ connection, timeoutMs, target })`             |
| `RedisShutdownService`   | the close state for one owner                    | `shutdown(connection)`                                |

```text
  RedisEnvironment                  the raw env values, supplied by the caller
  { url, clusterEndpoints,          (never read from process.env here)
    dbIndex, skip }
        │
        ▼
  RedisConfigService.resolve()  ──▶ RedisConfigResolution
        │                             standalone { url, db, tls }
        │                             cluster    { endpoints, db: 0 }
        │                             unconfigured { reason }   ← first-class
        ▼
  RedisConnectionService.connect()  ──▶ RedisConnection | null
        │                                (Redis | Cluster)
        ▼
  RedisReadinessService.ping()      ──▶ resolves, or rejects. Never exits.
        │
        ▼
  RedisShutdownService.shutdown()   ──▶ disconnects once per owned connection
```

`null` is a supported outcome, not an error: deployments and test runs without
Redis are normal, and every consumer branches on it to take a documented
fallback.

## Using it

The app's composition root builds the one connection and hands it out as
`getApp().redis`; nothing else in the platform constructs a client. The same
composition root should keep one `RedisShutdownService` and use it when the App
closes, rather than calling `disconnect()` at individual call sites.

```ts
const redis = new RedisConnectionService({ logger }).connect({
  url: config.redisUrl,
  clusterEndpoints: config.redisClusterEndpoints,
  dbIndex: config.redisDbIndex,
  skip: config.skipRedis,
});
```

Two callers legitimately build their own, because they run outside a serving
process and close what they open: `replayPreset` (which needs
`connectStandalone` — its multi-key work is rejected with CROSSSLOT on a
cluster) and the `migrateObjectStorage` task, which boots no App at all.

For a decision that must be made before any connection exists — better-auth
picks its session-storage strategy at module scope — ask the _configuration_,
not a client:

```ts
new RedisConfigService().isConfigured(redisEnv);
```

## What is deliberately not exported

The endpoint and database-index parsers are private. They are details of
`resolve()`, and the behaviour they carry is covered through it — which is how
`specs/server/redis-client-ownership.feature` frames it too ("When the
configuration is resolved").

There is no offline-queue option. The call sites this package replaced passed
`offlineQueue: false`, which ioredis never reads from its constructor options,
so the offline queue has always been on. Turning it off for real is a behaviour
change with its own callers to fix first, not a rename — see the note on
`SHARED_OPTIONS` in `connection.ts`.

## Guardrails

The rule is: no file may name the retired singleton, and no file outside this
package may construct an ioredis client. Two source guards used to enforce
this in `platform/app/src/server/app-layer/__tests__/redis-ownership.unit.test.ts`,
one test per pattern so a gap in either would fail silently rather than
together. `platform/app` is deleted and this repo-wide check has not been
re-established anywhere else — treat the rule as convention, not as something
CI currently verifies, until a replacement guard lands.
