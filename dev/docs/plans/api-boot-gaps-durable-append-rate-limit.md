# Two API boot warnings, audited end to end

`withoutDurableAppend` and `withoutRateLimit` were both classed **REAL GAP** in
the `core-application-feature-extraction-plan.md` ledger section "API absences
audited: 43 named, 4 closed, 12 claims corrected". This brief traces each to its
throw, states what a production deployment actually does today, and names the
smallest honest closure. Nothing here is fixed.

Both classifications survive the audit. Both severities were overstated in one
direction and understated in another, and one of the two recommended closures
turns out to be the wrong repair.

---

## 1. `withoutDurableAppend`

### The claim, and where it fires

`apps/api/src/app/api-identity-pipelines.composition.ts:156` calls
`options.report?.withoutDurableAppend()` **unconditionally on the queue-present
branch** — the branch every production deployment with Redis takes. It logs at
`warn` (`:289-294`):

> API holds a producer-only event store, so the join-request ledger's own
> durable append refuses: the command is staged but the facts are not written by
> this process

**That message is backwards.** The append is line `:150` of the ledger and the
stage is line `:156`; the append rejects, so `stage` is never reached. Nothing is
staged. The warn describes a failure mode that cannot occur.

### The path, before

```
  browser
    │  joinRequests.request / .approve / .reject / .withdraw   (tRPC)
    ▼
  api-trpc-collaborators.identity.composition.ts:1078-1087
    │
    ▼
  JoinRequestsService ──► JoinRequestService.commit
                              join-request.service.ts:96
    │
    ▼
  JoinRequestLedgerWriter.commit          join-request-ledger.adapter.ts:138
    │
    ├─ 1. eventStore.storeEvents(...)                             :150  ◄── HERE
    │       └─ ApiEventingIdentityAdapter.tryEventStore
    │            api-identity-eventing.adapter.ts:60-78  →  runtime is enabled,
    │            so it answers the store rather than null
    │       └─ EventStoreProducerOnly.storeEvents
    │            eventStoreProducerOnly.ts:95
    │            → Promise.reject(ConfigurationError)
    │                                                    ╳ REJECTS
    ├─ 2. stage(command)                                  :156   ── never runs
    └─ 3. awaitFold(...)                                  :157   ── never runs
```

`commit` has no `try`/`catch`. `JoinRequestService` and `JoinRequestsService`
have none either. So the rejection reaches the tRPC boundary as a
`ConfigurationError` — which extends `CriticalError` → `Error`
(`packages/eventing/src/services/errorHandling.ts:172`), **not** `HandledError`.
It therefore degrades to a generic "unknown error" plus a trace id, which is
precisely the outcome `CLAUDE.md` calls a bug in the feature.

### What is composed, and what is not

`apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts:90-102`
makes three decisions in one object literal:

| Decision | Line | What it governs |
| --- | --- | --- |
| `eventStore: EventStoreProducerOnly.create(...)` | `:93` | whether this process can **append** |
| `processManagerMode: "producer-only"` | `:94` | whether it **runs** inboxes, outboxes and wakes |
| `consumersEnabled: false` | `:99` | whether it **claims** `event-sourcing/jobs` |

They read as one property, and the docblock (`:35-67`) states it three times
over. They are independent: `processManagerMode` is read only at
`packages/eventing/src/eventSourcing.ts:159-165`, `:245-251` and `:294`, and
**touches `storeEvents` nowhere**. A process can hold a durable store and still
be a pure producer.

Missing on `apps/api`, precisely:

1. **A `retention` config leaf.** `grep -i retention
   apps/api/src/platform/config/api.config.ts` returns zero hits.
   `EventingClickHouseEventStore.create` requires an
   `EventingRetentionConfiguration`
   (`packages/eventing/src/server/adapters/clickhouse/event-store.clickhouse.ts:36-39`).
   The worker has the leaf at `apps/worker/src/platform/config/worker.config.ts:474`,
   `:964-965`, `:1037`.
2. **A wiring seam.** `ApiEventingInfrastructureOptions` (`:26-32`) carries only
   `resources`, `queue` and `processName`. There is no parameter a ClickHouse
   resolver could arrive through.
3. **Ordering.** Eventing composes at `api-production.composition.ts:734`;
   ClickHouse only at `:2387`, after tenancy. A resolver would have to be passed
   as a thunk.

**Not missing:** a Postgres outbox table, a lease, and a `ProcessStore`. The
durable event log is **ClickHouse**, not Postgres — `event_log`, written by
`EventingClickHouseEventRepository`. `apps/api` already holds a tenant-keyed
ClickHouse resolver (`api-clickhouse.infrastructure.ts:206-207`) that
structurally satisfies `EventingClickHouseClientResolver`, and already declares
`@langwatch/eventing` (`apps/api/package.json:93`) whose `./server` subpath is
unconditional. A lease and a process store belong to process-manager *running*,
which producer-only correctly keeps off this process.

### Does the worker own the durable half? Yes

- Production worker: `worker.entrypoint.ts` → `startStandaloneWorker` →
  `WorkerStandaloneComposition`, which is the **only** site in the tree setting
  `consumers: { enabled: true }`
  (`apps/worker/src/app/worker-standalone.composition.ts:99`).
- The durable store is built at
  `packages/eventing/src/server/eventing-server-runtime.ts:41-50` and reached
  from `apps/worker/src/platform/eventing/worker-eventing.runtime.ts:101-104`.
  That runtime passes **no** `processManagerMode`, so it defaults to `"run"`.
- All four identity pipelines are registered consumer-side, join-requests
  unconditionally at `worker-production.composition.ts:1404-1417` via
  `PostgresJoinRequestPipelineAdapter`, installed at
  `apps/worker/src/features/identity/join-request-worker-feature.installer.ts:56`.

So the API's absence is **not** the producer-only ruling being applied
correctly. It is one ledger that never received a correction the others did.

### The actual defect: an unmigrated ledger, not a missing collaborator

ADR-101 pinned the original order — *"durable append to ClickHouse first
(waited), the command staged onto the per-user GroupQueue second"*
(`dev/docs/adr/101-identity-pipeline-and-identifiers.md:105`).

ADR-110 corrected it, and ADR-116 records the correction
(`dev/docs/adr/116-account-linkage-is-event-truth.md:213-217`):

> the queued run is the sole appender (ADR-110's shape: appending on the calling
> path as well and staging afterwards writes every fact twice, because the staged
> run re-executes the guard against heads the fold has not advanced yet)

`IdentityLedgerWriter` took the correction —
`packages/features/identity/server/src/adapters/identity-ledger.adapter.ts:11`
says so in as many words, and its deps have no `eventStore` field at all
(`:90-104`). The grants ledger took it. **`JoinRequestLedgerWriter` did not**,
though its own docblock claims to be "in the shape the identity, connection and
grants ledgers already have (ADR-110, ADR-101)".

And the queued handler is a full appender for join requests:
`packages/identity-eventing/src/join-requests/commands/joinRequestCommands.ts:72-81`
re-runs `guards[verb](data)` and returns the events for the runtime to append —
the same shape the identity ledger relies on.

This matters for the repair. Giving `apps/api` a durable event store would make
each join-request ceremony append **twice** — once on the calling path, once in
the queued re-run — which is the exact defect ADR-110 exists to correct. The log
converges (the store dedupes `commandId:index` on read) but carries two rows per
ceremony.

### The path, after (recommended)

```
  browser
    │  joinRequests.request / .approve / .reject / .withdraw
    ▼
  JoinRequestLedgerWriter.commit
    │
    ├─ 1. stage(command)  ──────────────► event-sourcing/jobs  (Redis)
    │                                            │
    └─ 2. awaitFold(...)  ◄── observes           │
              Postgres projection                ▼
                    ▲                     apps/worker
                    │                       │ re-runs guards
                    └───────────────────────┤ appends to event_log  (ClickHouse)
                            fold             └ folds the projection
```

The API stops appending. The worker — which already registers this pipeline,
already holds the durable store and already re-runs the guards — becomes the
sole appender, exactly as it already is for identity and grants.

### Severity

**Latent, not live — but a total outage the day it is switched on.**

The four tRPC verbs sit behind the `join_requests` feature flag, whose
`defaultValue` is `false`
(`packages/features/feature-flag/contract/src/feature-flag.ts:384-388`): *"no
join command is ever dispatched. This is the whole of the rollback."* No
`JOIN_REQUESTS` appears anywhere in `charts/`. The two invitation side-effects
(`resolveByInvitation`, `withdrawOnInvitationAccepted`) both short-circuit on
`if (!open) return;`
(`packages/features/identity/server/src/services/join-requests.service.ts:443`,
`:478`), so with no requests in existence they never reach the ledger.

Turn the flag on and every join-request verb fails at the door with a generic
unknown error, and the two invitation side-effects fail silently — the
organization transport swallows them by design
(`packages/features/organization/server/src/transport/api-trpc/organization.api.ts:986-995`,
`:1141-1149`), leaving the request open on the admins' panel with nothing saying
why.

**One live loss, separately.** `ScimSyncLedgerWriter` is the second
append-then-stage ledger and it **is** composed on `apps/api`
(`api-scim.composition.ts:198`) — which makes
`api-identity-pipelines.composition.ts:54-56` ("Nothing on this process composes
`ScimSyncLedgerWriter`") false. Its `commit` catches, logs at `error` and returns
(`eventing.scim-sync-ledger.adapter.ts:118-127`), so every enterprise SCIM push
loses its directory-sync history fact, permanently, today. That degradation is
deliberate and documented; that it is total on this process is not. It is also
doubly broken: `scim-sync` is left unregistered, so even a successful append
would find no sender to stage through.

**Everything else `apps/api` produces is stage-only and unaffected** — gateway
spend, trace ingest, experiment runs, agents, authz grants, identity. That is
the producer-only design working as intended.

### Why no test caught it

The one test covering this path,
`apps/api/src/app/__tests__/api-trpc-collaborators.identity.composition.integration.test.ts:848-860`,
asserts "Leg one: the durable append" and passes — because its `producerEventing()`
helper composes `EventStoreMemory.createForTesting()` (`:793`), not
`EventStoreProducerOnly`. That is precisely the substitution
`eventStoreProducerOnly.ts:29-31` warns about: *"a memory store in the same seat
would ACCEPT that append, hold the event in one process's heap, and lose it"*.
The helper is named for the production shape and does not have it.

There is **no** unit test for `JoinRequestLedgerWriter` anywhere.

### Smallest honest closure

Finish ADR-110 for join requests. Make the queued run the sole appender.

| File | Change | Size |
| --- | --- | --- |
| `packages/features/identity/server/src/adapters/join-request-ledger.adapter.ts` | Delete the `eventStore` dep, its resolver and the `storeEvents` call; `commit` becomes `stage` then `awaitFold`. `events` is still computed locally by `joinRequestEventsFor`, so the return contract is unchanged | ~25 lines removed |
| `apps/api/src/app/api-identity-pipelines.composition.ts` | Delete `withoutDurableAppend` and its logger leg; the absence no longer exists | ~15 lines removed |
| `apps/api/src/app/__tests__/api-trpc-collaborators.identity.composition.integration.test.ts` | Re-point "leg one" at the staged command; compose `EventStoreProducerOnly` rather than the memory store, so the test has the production shape | ~20 lines |
| new: `packages/features/identity/server/src/adapters/__tests__/join-request-ledger.adapter.unit.test.ts` | The ledger has no unit test; the stage-only contract deserves one | ~80 lines |

Roughly **half a day**, one package and one application, no config leaf, no new
collaborator, no doctrine change. It also deletes a double-append that would
otherwise appear the moment a durable store existed anywhere on the producer
side.

SCIM is a **separate, smaller decision** and should not ride along: either
register `scim-sync` producer-only and make its writer stage-only too (the same
repair, ~15 lines), or accept that the directory-sync history does not exist on
this deployment and say so in one place instead of two contradicting docblocks.

### Wiring gap or product decision?

**Wiring gap — closable by a lane**, on the recommended path. Making the queued
run the sole appender applies a decision that is already made, in an accepted
ADR, and already applied to the two sibling ledgers.

The ledger's own suggested closure — compose `EventingClickHouseEventStore` on
`apps/api` — *is* a product decision, and it is the wrong one: it contradicts the
producer-only property stated three times in `api-eventing.infrastructure.ts`,
needs a config leaf and a thunked resolver, and reintroduces the double-append
ADR-110 removed. Recommend against.

Two doc corrections belong in the same change either way: the backwards warn
message at `api-identity-pipelines.composition.ts:292`, and the false "nothing
composes `ScimSyncLedgerWriter`" claim at `:54-56`.

---

## 2. `withoutRateLimit`

### The claim, and how small it actually is

`apps/api/src/api-secret-rest.feature.ts:82` declares
`.withoutRateLimit("No public REST rate limiter is composed yet.")`. It entered
on 2026-08-28 in `f9dbf94c8a` "Mount Secret REST in the API process" — a bare
one-line commit, which is why the audit found no ledger record for it.

`createRestService` is called **exactly once in the repository's production
code**, at `api-secret-rest.feature.ts:66`, and `ApiSecretRestFeature.create`
runs it four times for four base paths (`/api/v1/secret`, `/api/v1/secrets`,
`/api/secret`, `/api/secrets`). Every one of them is authenticated by project
API key (`auth: options.security.authenticationMiddleware()`,
`openapiSecurity: [{ project_api_key: [] }]`, `:77-80`).

So the audited absence covers **four base paths on one authenticated,
tenant-scoped family**. Taken by itself it is the least urgent rate-limit
problem in the process. Auditing it, however, turned up two larger ones that
nobody declared.

### The declaration is a build gate, not a limiter

`withoutRateLimit` is not decorative. `packages/api/src/rest/builder.ts:515-518`
and `packages/api/src/rest/definition.ts:626-630` **throw at mount** unless a
`public-rest` endpoint declares `withRateLimit()` or `withoutRateLimit(reason)`,
and `builder.ts:535-539` throws if `withRateLimit` is declared with no composed
port. The absence exists because somebody was forced to state it. That is the
system working.

What it does at runtime is nothing: `definition.ts:431-432` sets
`rateLimit = false`, `mergeDefs` deletes the key (`definition.ts:502`), the
`if (config.rateLimit)` guard at `packages/api/src/rest/pipeline.ts:115-127`
never fires, and **no middleware is installed**.

### The substrate is real, shared and Redis-backed

`ApiRateLimitInfrastructure`
(`apps/api/src/platform/infrastructure/api-rate-limit.infrastructure.ts:66`) is a
faithful port of the platform's `server/rateLimit.ts` — same
`langwatch:ratelimit:` prefix, same `INCR`/`EXPIRE`/`TTL`-readback arithmetic
(`:102-121`), same 1000-entry memory GC, with the Redis connection injected
rather than pulled from a global. One instance is built at
`api-production.composition.ts:619` over the queue's Redis, deliberately:
*"two limiter instances would give a caller two budgets for one rule."* It is
fanned out to roughly fifteen call sites.

The product is not unprotected. Verified limits in force today:

| Surface | Limits | Cite |
| --- | --- | --- |
| Sign-in, sign-up, password reset, passkey register | 100/min default; 30 per 15 min on `/sign-in/email`; 50/hr sign-up; 5/hr reset; 50/hr passkey — Redis-backed when available | `packages/features/auth/server/src/transport/better-auth/better-auth.api.ts:423-450`, `:772-775` |
| RUM ingest | 6000/min global, then 120/min per caller — global bucket checked **first** so a flood cannot mint a Redis key per request | `apps/api/src/features/rum/rum-ingest.service.ts:264-289` |
| Hosted-MCP OAuth | 30/min register, 30/min token, 20/min auth-fail, per IP | `packages/features/hosted-mcp/server/src/transport/api-mcp/hosted-mcp.api.ts:245-253` |
| Stored-object / files REST | per-caller fixed window | `apps/api/src/app-rest/app-rest.packaged-families.ts:474`, `:660` |
| Invite send, join-request ask | per-invitation and per-person windows | `api-organization-invites.composition.ts:205`; `api-trpc-collaborators.identity.composition.ts:1005`, `:1135` |
| Governance ingest | 60/min per IP, key `lwingest:rate:` kept from the platform | `apps/api/src/features/enterprise/governance-ingest-rest.mount.ts:82` |

The RUM one is the best-reasoned limiter in the tree and is the model for
anything closed here.

### The real exposure is next door, and undeclared

**(a) The anonymous share-link read is stubbed to always-allow.**

`apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts:520-523`:

```ts
// The share read's own throttle is not composed on this process yet, so
// it does not throttle: refusing every anonymous read instead would
// take a working public surface off the air over a missing counter.
rateLimit: () => Promise.resolve({ allowed: true }),
```

Everything else about that limit exists and is correct.
`packages/features/trace/server/src/transport/api-trpc/shared-trace.api.ts:59-61`
sets 60 reads/min per share token and 120/min per client IP; `:147-176`
enforces both and raises `ShareReadRateLimitedError`, a real `HandledError` with
code `share_read_rate_limited` registered at
`packages/handled-error/src/app-codes.ts:392` and customer copy at
`presentation.ts:2244` ("This shared trace is busy right now"). The endpoint's
own docblock says the numbers are *"tight enough that the endpoint is not a
cheap way to drive repeated ClickHouse fan-out from outside."*

That refusal can never fire, and it is a clean regression. The platform composed
the real counter in the same ports object —
`git show 70daaffd2c^:platform/app/src/runtime/app/features/trace.ts`, line 526
`rateLimit,` (imported at `:79` from `~/server/rateLimit`), sitting directly
above `getClientIp` at `:527` and `isTraceNotFound` at `:528`. **Both
neighbours came across the extraction intact; the one between them became a
stub.**

It is unauthenticated, it fans out to ClickHouse, and **nothing logs it at
boot** — unlike `withoutDurableAppend`, which at least announces itself. No test
anywhere asserts the share read limit, which is why CI stayed green.

**(b) 351 route registrations cannot reach the limiter at all.**

`SecuredApp.access()` builds plain Hono routes with the policy chain prepended
(`packages/api/src/rest/security/rest-api-service.ts:258-312`) instead of going
through `buildEndpointPipeline`. `grep -rn "rateLimit\|rateLimiter"
packages/api/src/rest/security/` returns **zero hits**. So `rateLimitMiddleware`
is structurally unreachable from **351 `.access(...)` registrations** across
`packages/features/*/server`, `packages/enterprise/features/*/server` and
`apps/api/src/features`. The mount-time gate that forces a declaration is scoped
`if (endpoint.kind === "public-rest")` (`builder.ts:515`), so none of the 351 is
ever asked to decide, and none reports anything.

Among them, uncapped and worth naming: OTLP ingest
(`packages/features/trace/server/src/transport/api-rest/otlp-ingest.api.ts:516`)
and the SDK collector (`collector.api.ts:177`) — both project-API-key
authenticated and body-limited only; the SCIM protocol's twelve bearer routes
and its webhook intake, whose shared secret is compared in-handler
(`scim-webhook-intake.api.ts:47-50`) with no cap, so it is brute-forceable; the
Stripe and ElevenLabs webhooks; four GitHub setup/webhook routes; and the
SSRF-guarded image proxy (`apps/api/src/features/image-proxy/image-proxy-rest.ts:51`).
For the two ingest paths the compounding matters: the ledger's
`absent("plan-allowance")` row records that `UsageService` is composed by
nobody, so span ingest has neither a rate limiter nor a usage meter.

**No tRPC middleware-level limiting exists** — every tRPC limit in the product
is a per-procedure domain throttle. And **there is no rate-limit config leaf**:
`grep -n "rate\|limit\|throttle\|burst" apps/api/src/platform/config/api.config.ts`
matches only docblock prose. Every budget is a hard-coded literal at its call
site.

### The path, before and after

```
BEFORE

  authenticated project API key
    │
    ▼   /api/v1/secret*  (4 base paths)
  buildEndpointPipeline            pipeline.ts:115-127
    │  auth ─► permission ─► [ if (config.rateLimit) ] ─► resource limit ─► handler
    │                              └── false, key deleted by mergeDefs
    │                                  NO middleware installed          ◄── withoutRateLimit
    ▼
  handler

  anonymous, no credential
    │
    ▼   sharedTrace.get  (tRPC)
  enforceShareReadLimit            shared-trace.api.ts:147
    │  rateLimit({ key: sharedTrace:token:… , 60/min })
    │  rateLimit({ key: sharedTrace:ip:…    , 120/min })
    │        └──► () => ({ allowed: true })   ◄── STUB, silent
    ▼
  5 ClickHouse reads + a view write, unbounded

  351 × SecuredApp.access(...)
    │
    ▼
  plain Hono route + policy chain    rest-api-service.ts:258-312
    │  buildEndpointPipeline is not on this path
    │  rateLimitMiddleware unreachable; no declaration demanded
    ▼
  handler


AFTER (recommended order)

  anonymous, no credential
    │
    ▼   sharedTrace.get
  enforceShareReadLimit
    │  └──► (input) => this.rateLimiter.consume(input)      ◄── 1. wire the counter
    │            ApiRateLimitInfrastructure  ──► Redis
    ▼
  429 share_read_rate_limited, with the copy already written

  authenticated project API key
    │
    ▼   /api/v1/secret*
  buildEndpointPipeline
    │  … ─► rateLimitMiddleware ─► …                        ◄── 2. after a budget decision
    │        RateLimiter.check(key) ──┐
    ▼                                 └─ adapter ─► consume({ key, windowSeconds, max })
  handler                                            ▲
                                        window + max come from WHERE?  ◄── the open question
```

### Why the port was never composed — and it is not the shape

`packages/api/src/ports.ts:16-18`:

```ts
export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}
```

against the substrate (`api-rate-limit.infrastructure.ts:78`):

```ts
consume(input: { key: string; windowSeconds: number; max: number })
  : Promise<{ allowed: boolean; remaining: number; resetAt: number }>
```

The `resetAt` → `retryAfterSeconds` conversion is trivial and is already written
verbatim, onto a near-identical `check()` signature, at
`apps/api/src/features/enterprise/governance-ingest-rest.mount.ts:80-92` (~12
lines). The audit's "the shapes differ" is true but is not the blocker.

The blocker is that **`withRateLimit()` is nullary** (`definition.ts:409-413`)
and `check(key)` carries no budget, so there is nowhere in the framework to
express a per-endpoint window and maximum, and no config leaf to hold a default.

And one trap that must be sized in before anyone composes it: the principal
ladder at `capabilities.ts:64-77` falls through apiKeyId → resolvedToken →
user → organization → project → **`"anonymous"`**. It has no IP awareness, so
every unauthenticated caller collapses into a single shared bucket. Composing
the port as-is would be actively wrong for public routes — it would refuse real
users on behalf of an attacker. The middleware also **fails closed** on a
limiter error (`capabilities.ts:38-41` rethrows), which is right, and means a
Redis blip becomes a 500 rather than a bypass.

### Severity

**The audited absence: low.** Four base paths, project-API-key authenticated,
tenant-scoped, and honestly declared under a build gate that would not let it be
hidden. Abuse requires a valid key, and the blast radius is one tenant's secrets
family.

**What the audit uncovered: high, and it is not this absence.** The anonymous
share-link read is unbounded against ClickHouse with the refusal fully built and
disabled by one line, silently. That is the abuse exposure. The 351 bypassing
registrations are a medium structural finding — no single one is alarming, but
the framework's forcing function does not reach any of them, so the count can
only grow without anyone being asked.

### Smallest honest closure

Two changes, in this order, and only the first is a lane's work.

**1. Wire the share-link counter.** This is the whole of it:

| File | Change | Size |
| --- | --- | --- |
| `apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts` | Take a `rateLimit` option; replace the always-allow stub with it | ~6 lines |
| `apps/api/src/app/api-production.composition.ts` | Pass `rateLimit: (input) => this.rateLimiter.consume(input)` into `composeApiTraceGroupCollaborators` at `:2771`, exactly as `composeUnsubscribe` already does at `:2125` | ~3 lines |
| new: a test over `enforceShareReadLimit` | There is none anywhere; the limit has zero coverage, which is how a stub passed CI | ~60 lines |

An hour or two. No new package, no config, no decision — the counter is three
files away and the per-token and per-IP keys are already chosen.

**2. Compose the framework port.** ~15 lines of adapter (copy
`governance-ingest-rest.mount.ts:80-92`) **plus a decision**, and the decision is
the work:

- Where does the default window and maximum live? `withRateLimit()` is nullary,
  so either it grows arguments, or the adapter holds one budget for every
  endpoint, or `api.config.ts` grows its first rate-limit leaf.
- Does the principal ladder learn about client IP before any public route uses
  it? `apiClientAddress` already exists on this process and is passed to the
  unsubscribe family (`api-production.composition.ts:2126`).
- Do the 351 `.access(...)` registrations get limited too, and if so does
  `SecuredApp.access` move onto `buildEndpointPipeline`? That is much the
  largest question here and does not have to be answered to do the rest.

### Wiring gap or product decision?

**Both, split cleanly.**

The share-link stub is a **wiring gap, closable by a lane today** — a regression
against the platform, with the counter, the keys, the error, the code and the
customer copy all already in the tree.

`withoutRateLimit` itself is a **product decision (Alex's call)**: default
budgets, whether anonymous callers are counted by address, and whether the
security path joins the pipeline. Composing the port without those answers
would limit four authenticated base paths, leave the one anonymous hole open,
and put every anonymous caller in one bucket — motion rather than protection.
The declaration should stay until the budgets exist.

One caveat this repository cannot settle: production infrastructure lives in the
separate `saas` repo. `charts/` declares **no** edge rate limiting — no
`limit-rps`/`limit-rpm`/`limit-connections` anywhere, ingress annotations default
to `{}` (`charts/langwatch/values.yaml:1555`), and there is no Cloudflare config
here. If an edge limiter exists it is defined where this audit cannot see it,
and that should be checked before treating the share-link path as fully exposed.

---

## What changed against the ledger

| Row | Ledger said | This audit says |
| --- | --- | --- |
| `withoutDurableAppend` | REAL GAP; blocker is a missing `retention` leaf; close by composing a durable store | REAL GAP, but the repair is the opposite direction: the ledger is one ADR-110 correction behind, and composing a store would double-append. Latent behind `join_requests` (default off), not live |
| `withoutRateLimit` | REAL GAP; substrate exists, shapes differ | Accurate and low-severity. The shape delta is ~12 lines; the real blocker is that no budget can be expressed. Two undeclared and larger holes sit beside it |

Neither item appears in `core-application-exit-decisions-for-review.md`. Both
belong there.

