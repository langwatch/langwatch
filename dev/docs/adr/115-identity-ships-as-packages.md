# ADR-115: Identity ships as `@langwatch/identity` and `@langwatch/identity-server`

**Date:** 2026-08-24

**Status:** Accepted (2026-08-24)

**Builds on:** ADR-101 (the identity pipeline and identifiers — every
decision there stands; this ADR changes where the code lives, not what it
does), ADR-092 §"Related" (the authz engine's two-package shape),
ADR-070 (dependency direction is what packages enforce), ADR-019 and
`dev/docs/best_practices/repository-service.md` (repository / service
layering).

**Related:** PR #7333 (Wave 1, the code this reshapes), ADR-110, ADR-114.

## Context

Wave 1 of the identity platform (PR #7333) landed the identity pipeline,
the `Identifier` projection, the better-auth adapter facade, the PKCE
verification ceremony and the backfill rider.
The behaviour is right and ADR-101 records why. The shape is not, and the
comparison that makes it obvious is the feature next to it.

The authorization engine (ADR-092) is two workspace packages and one
composition root:

```text
@langwatch/authz            pure, isomorphic: vocabulary + decide(). types: [] — a
                            node:* import does not compile. No Prisma, no env.
@langwatch/authz-server     service CLASSES over repository INTERFACES. No storage
                            engine, no env read: every knob is a closure the app hands in.
platform/app
  app-layer/authz/runtime.ts   THE composition root: the one place Prisma, redis,
                               KSUID and the pipeline handle meet the services.
  app-layer/authz/ledger.ts    emission: the pipeline senders, convergence, the fork.
  app-layer/authz/repositories Prisma implementations of the package's ports.
  event-sourcing/pipelines/authz-grants   commands are "pure appends: validate,
                               stamp identity, emit"; projection + subscriber.
```

Identity today is the same responsibilities without the boundaries. Read
against that reference, the inventory of #7333 shows:

- **No package.** Everything is under `platform/app`. The pure logic — id
  derivation, normalization, the reducer, the lifecycle vocabulary, the
  backfill's parity policy, the PKCE helpers — is interleaved with Prisma
  defaults, `tryGetApp()` and prom-client.
- **One class is four things.** `app-layer/identity/identity-ceremonies.ts`
  (366 lines) is a service locator (a `tryGetApp()` polling loop), a second
  command-handler registry duplicating `pipeline.ts`, the dispatch
  orchestrator, and a hand-rolled cursor-guarded fold. Everything downstream
  is shaped by it: the adapter constructs it lazily, the migration takes it
  as a dep, the route composes it.
- **Four composition roots.** `presets.ts` (two repositories),
  `system-migrations/runtime.ts` (the migration plus a fresh
  `IdentityCeremonies`), `app/api/identity/[[...route]]/app.ts`
  (`composeVerificationCeremonies()` newing three repositories, plus a
  module-level mutable test seam), and `better-auth/identityDatabase.ts` (a
  lazily-constructed `IdentityCeremonies`). Four `new IdentityCeremonies({
  prisma })` sites, none sharing anything.
- **A dependency cycle.** `app-layer/identity → better-auth/identityRouting`
  (for one pure function, `identifierProviderFor`) while
  `better-auth/identityDatabase → app-layer/identity`.
- **Prisma outside repositories.** `app-layer/identity/user-hash-key.ts`
  and `better-auth/accountCeremonies.ts` run queries directly; three modules
  default `prisma` from `~/server/db` at module scope.
- **Errors in three places.** Pipeline refusals in
  `pipelines/identity/commands/identityCommandErrors.ts`, verification
  errors inside the verification service, `IdentitySessionRequiredError`
  inside the route file.
- **A cross-pipeline leak.** `pipelines/authz-grants` imports
  `eventIdempotencyKey` from `pipelines/identity`.
- **Dead exports.** `IDENTITY_APP_HANDLE_WAIT_MS`, `IDENTITY_STAGING_TIMEOUT_MS`,
  `IDENTITY_PROJECTION_VERSION`, `identifierArrivalStateSchema`,
  `sha256Hex`, `IDENTITY_BACKFILL_ACTOR_ID`; and `markPrimary` has no
  production caller.
- **No integration test on any Prisma repository.** Every repository is
  covered only through hand-written fakes.

The identity-vs-authz gap is exactly what ADR-070 says packages are for:
*"Splitting code into packages does not, by itself, reduce runtime memory
or typecheck cost. Dependency direction does. Packages make direction
enforceable (a forbidden import fails to resolve) and visible."*

## Decision

Identity takes the authz shape: a pure core package, a server package of
services over ports, and one composition root in the app. ADR-101's
decisions — the dispatch order, the write seam, the per-user write gate,
`tenantId = userId`, the payload rule, erasure — move into the layer that
owns them.

This ADR originally said those decisions were *untouched* by the reshape,
and for the reshape itself that was true. Two of them were then revised on
their own merits on 2026-08-24, and this document records the result rather
than the original: ADR-101 §2 replaced the routing facade with better-auth's
`databaseHooks`, and withdrew the calling-path fold along with the D02
Redis-loss requirement it existed for. The layering below is unchanged by
either.

### 1. The three layers

```text
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ @langwatch/identity                     pure · isomorphic · types: []      │
 │                                                                            │
 │  vocabulary   providers, lifecycle states, verification methods,          │
 │               arrivalStateForProvider, identifierProviderFor              │
 │  identifier   normalizeIdentifierValue, identifierDomain                  │
 │  facts        IdentifierFact, IdentityHeads, the fact payload schemas,     │
 │               event/command type strings, IDENTITY_EVENT_VERSION_LATEST   │
 │  reduce       reduceIdentity(heads, fact) — the one reducer               │
 │  backfill     backfillParityDiffs, orphanedIdentifierRows — what the      │
 │               proof means, over row shapes                                │
 │  errors       the refusal family + the verification errors                │
 └───────────────────────────────────────────────────────────────────────────┘
                                      ▲
 ┌────────────────────────────────────┴──────────────────────────────────────┐
 │ @langwatch/identity-server     services over ports · no Prisma · no env    │
 │                                                                            │
 │  ports        IdentityHeadsRepository        (find*: hash key, heads,      │
 │                                               active-by-value, by account)│
 │               IdentityLedger                 (commit — THE emission seam) │
 │               IdentityVerificationRepository (replace / find / consume)   │
 │               IdentityBackfillRepository     (find user / accounts / rows)│
 │               IdentityUsersRepository        (storeUserHashKeyIfMissing)  │
 │  guards       IdentityGuards                 (veto-before-write; ONE      │
 │                                               implementation for the      │
 │                                               calling path and the queue) │
 │  services     IdentityService                (the five verbs)             │
 │               VerificationCeremonyService    (PKCE mint / complete)       │
 │               IdentityBackfillService        (adopt, establish, detach,   │
 │                                               prove — one user)           │
 │  crypto       deriveIdentifierId, computeIdentifierHash, mintUserHashKey, │
 │               s256Challenge, sha256Hex, safeEqualHex   (node:crypto)      │
 │  ./better-auth   IdentityCeremonies — the four databaseHooks ceremonies   │
 │               (attach, detach, hash-key mint, erase)                      │
 └───────────────────────────────────────────────────────────────────────────┘
                                      ▲
 ┌────────────────────────────────────┴──────────────────────────────────────┐
 │ platform/app                                                               │
 │                                                                            │
 │  app-layer/identity/runtime.ts        THE composition root                 │
 │  app-layer/identity/ledger.ts         IdentityLedgerWriter implements      │
 │                                       IdentityLedger: envelope → append    │
 │                                       WAITED → stage → bounded wait for    │
 │                                       the queue's fold (ADR-110)           │
 │  app-layer/identity/write-gate.ts     isUserOnIdentityWrites (cached gate) │
 │  app-layer/identity/repositories/     *.prisma.repository.ts, one per port │
 │  app-layer/identity/identifier-backfill.migration.ts  SystemMigration      │
 │                                       adapter over IdentityBackfillService │
 │  event-sourcing/pipelines/identity/   schemas (framework envelope over the │
 │                                       package's payloads), THIN commands   │
 │                                       (reads → decide → envelope), fold    │
 │                                       projection over reduceIdentity       │
 │  better-auth/index.ts                 stock prismaAdapter + four           │
 │                                       databaseHooks → identityCeremonies() │
 │  api/routers/identity.ts              the tRPC router: session → service   │
 └───────────────────────────────────────────────────────────────────────────┘
```

Dependency direction, enforced by resolution rather than convention:

```text
  browser ──▶ @langwatch/identity  ◀── @langwatch/identity-server ◀── platform/app
                    ▲                          ▲                          │
                    └── zod, handled-error     └── actor, observability,  │
                                                   ksuid                  │
  never:  identity ──▶ anything;  identity-server ──▶ platform/app, Prisma, env,
          the event-sourcing framework;  better-auth/* ──▶ app-layer/identity
          (better-auth imports the RUNTIME only);  pipelines/authz-grants ──▶
          pipelines/identity.
```

### 2. `@langwatch/identity` — the pure core

The mirror of `@langwatch/authz`: `types: []` in `tsconfig.json` so a
`node:*` import or a `Buffer` reference does not compile; dependencies
`zod` and `@langwatch/handled-error` only. The frontend may import it (the
sign-in screens of D13 will want the provider vocabulary), so it reads and
writes nothing.

What moves in, and from where:

| Package module | From (#7333) | Notes |
|---|---|---|
| `vocabulary.ts` | `pipelines/identity/schemas/events.ts` (enums), `projections/identifierIdentity.ts` (`arrivalStateForProvider`), `better-auth/identityRouting.ts` (`identifierProviderFor`) | `identifierProviderFor` moving here dissolves the app-layer ↔ better-auth cycle |
| `identifier.ts` | `projections/identifierIdentity.ts` | `normalizeIdentifierValue`, `identifierDomain`; the crypto halves go to `identity-server/crypto` |
| `facts.ts` | `schemas/events.ts`, `schemas/commands.ts`, `schemas/constants.ts`, `reduceIdentity.ts` (`IdentifierFact`, `IdentityLedgerState` → `IdentityHeads`) | Zod schemas for the fact **payloads** and the command inputs, with `infer`; the framework envelope (`EventSchema`, `aggregateType`, `idempotencyKey`) is NOT here — the app's pipeline composes it, as `authz-grants/schemas/events.ts` composes `GRANT_EVENT_SOURCES`. `IdentityFact = { type, data, occurredAt }` is the framework-free shape the reducer folds |
| `reduce.ts` | `projections/reduceIdentity.ts` | Unchanged logic, framework-free input |
| `backfill.ts` | `migration/identifier-backfill.migration.ts` (`surplusRowDiffs`, `stateSatisfies`, `isLiveState`, `BackfillDiff`, the identifier row DTO) | The proof's policy is pure; `expectedIdentifiers` derives ids (node:crypto) and so lives beside the service in `identity-server` |
| `errors.ts` | `commands/identityCommandErrors.ts`, the two classes inside `verification-ceremony.ts` | All identity `HandledError`s in one module. Codes stay registered in `features/errors/logic/{codes,presentation}.ts` — the same arrangement as `permission_denied`, defined in `@langwatch/authz`, presented in the app |

`index.ts` opens with the same boundary statement `@langwatch/authz` carries.

### 3. `@langwatch/identity-server` — services over ports

The mirror of `@langwatch/authz-server`. Dependencies: `@langwatch/identity`,
`@langwatch/actor`, `@langwatch/handled-error`, `@langwatch/observability`,
`@langwatch/ksuid`; `better-auth` as a **peer** for the adapter's types.
No Prisma, no env, no `~/`, no `@langwatch/system-migrations` (the authz
package mirrors `MigrationTenantStatus` rather than importing the runner
— *"the authz side must not couple to the runner package"* — and identity
does the same: the backfill service returns its own outcome, the app's
`SystemMigration` adapter maps it).

One deliberate difference from `authz-server`: its root entry is
browser-evaluable because `rbac.ts` reaches it from the client, which is why
`deriveGrantId` hides behind `./migration`. Nothing in the browser reaches
identity-server, so its root barrel is server-only and says so, and the
crypto lives in a plain `crypto/` module. `frontend-boundary.unit.test.ts`
already walks the real graph and would fail the build the day that stops
being true; that guard is worth more than a subpath nobody needs.

**Ports** (`*.repository.ts`, interfaces, plain argument objects, `find*`
naming, an `actor` on every write that produces a fact):

```ts
export interface IdentityHeadsRepository {
  findUserHashKey(args: { userId: string }): Promise<string | null>;
  findHeads(args: { userId: string }): Promise<IdentityHeads>;
  findActiveIdentifierByValue(args: { normalizedValue: string }):
    Promise<{ userId: string; identifierId: string } | null>;
  findIdentifier(args: { identifierId: string }): Promise<IdentifierFact | null>;
  /** The projection row an Account row is linked to — what the adapter's
   *  account-delete ceremony reads, today as raw Prisma inside better-auth. */
  findIdentifierForAccount(args: { userId: string; accountId: string }):
    Promise<IdentifierFact | null>;
}

/**
 * THE emission seam — the identity analogue of AuthzGrantsRepository's
 * write verbs. The service has already taken its reads and run the
 * decision; the ledger is handed the command (for the staged re-run) and
 * the facts it produced (for the durable append). The app implements it
 * with ADR-101's pinned order; the package never learns there is a queue.
 */
export interface IdentityLedger {
  commit(args: {
    command: IdentityCommand;        // discriminated on type; carries commandId
    facts: IdentityFactInput[];      // what decide* returned
  }): Promise<IdentityFact[]>;
}

export interface IdentityVerificationRepository { replaceForIdentifier; findByIdentifierId; consume }
export interface IdentityBackfillRepository { findUser; findAccountRows; findIdentifierRows }
export interface IdentityUsersRepository { storeUserHashKeyIfMissing(args: { userId; userHashKey }) }
```

**The guards** (`guards.ts`): `IdentityGuards` over `IdentityHeadsRepository`
— the `handle()` bodies of the five pipeline commands, as one class. The
first cut of this ADR put them in the pure package as `decide*` functions;
they need `deriveIdentifierId` (node:crypto), and passing every read in
from both callers would have duplicated the read sequencing the guard
exists to own. They sit where `grant-validation.ts` sits for authz: in the
server package, over the port. One implementation serves the calling path
(`IdentityService`) and the queue's staged re-run (the app's thin command
handlers), which is what keeps the heads-carry rule (#7429) in one place.

**Services** (classes; `(port, deps)` constructors; every environment read
and side effect an injected closure):

```ts
export class IdentityService {
  constructor(
    private readonly guards: IdentityGuards,
    private readonly ledger: IdentityLedger,
  ) {}
  attachIdentifier(input) { /* parse → guards.attachIdentifier → ledger.commit */ }
  verifyIdentifier(input) { … }   markPrimary(input) { … }
  detachIdentifier(input) { … }   eraseUser(input) { … }
}

export class VerificationCeremonyService {
  constructor(
    private readonly store: IdentityVerificationRepository,
    private readonly heads: Pick<IdentityHeadsRepository, "findIdentifier">,
    private readonly identity: Pick<IdentityService, "verifyIdentifier">,
    private readonly deps: { isLatched: (a: { userId }) => Promise<boolean>; now: () => number },
  ) {}
  mintEmailVerification(…)   completeEmailVerification(…)
}

export class IdentityBackfillService {
  constructor(
    private readonly reads: IdentityBackfillRepository,
    private readonly users: IdentityUsersRepository,
    private readonly identity: Pick<IdentityService, "attachIdentifier" | "verifyIdentifier" | "detachIdentifier">,
    private readonly deps: { now: () => number },
  ) {}
  /** adopt → establish email → detach orphans → prove; the ADR-101 §6 pass for one user. */
  migrateUser(args: { userId: string }): Promise<IdentityBackfillOutcome>;
}
```

`isLatched` is a closure, not a default: today
`VerificationCeremonyService` reaches for `isUserOnIdentityWrites` when the
dep is omitted, which is the app's gate leaking into a service. The
package has no default to fall back to, so the wiring is visible in one
place.

**`./better-auth`** (`@langwatch/identity-server/better-auth`): one class,
`IdentityCeremonies`, holding the four methods the app binds to
better-auth's own `databaseHooks` — attach, detach, hash-key mint, erase.
Its collaborators are the package's own ports and service plus two closures
the app composes (the write gate and the clock).

**Revised 2026-08-24:** this subpath was originally the routing facade —
`createIdentityDatabase`, the routing table, `IdentityAdapterUnroutedWriteError`,
the transaction guard, `findAllRows` and `pinnedToIds` — over the stock
`prismaAdapter` as its row engine. ADR-101 §2 withdrew that seam in favour
of the hooks, and all of it is deleted. The package no longer depends on
better-auth at all, in any form: not a dependency, not a peer, not a type
import. `accountCeremonies.ts`'s two raw `prisma.identifier.*` queries
became `heads.findIdentifierIdForAccount`, and the ceremony's one `User`
read became `IdentityUsersRepository.findEmail`.
`secondaryStorageResilience.ts` was excluded from the move as D02's Redis
seam rather than identity-model code; **D02 was withdrawn on 2026-08-24 and
the file is deleted**, so nothing is left to place.

### 4. `platform/app` — one composition root, thin everything else

```text
platform/app/src/server/app-layer/identity/
  runtime.ts                     identityHeads, identityService(), verificationCeremony(),
                                 identityBackfill(), identityCeremonies(), registeredUserMigrations()
  ledger.ts                      IdentityLedgerWriter implements IdentityLedger;
                                 the lazy pipeline handle (the authzGrantsCommands() shape);
                                 IDENTITY_CONVERGENCE_TIMEOUT_MS; the metrics
  write-gate.ts                  isUserOnIdentityWrites over the cached gate + the state repository
  migration-name.ts              IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME (today it lives in the
                                 gate and the migration imports it back)
  identifier-backfill.migration.ts   implements SystemMigration; ~40 lines over IdentityBackfillService
  metrics.ts
  repositories/
    identity-heads.prisma.repository.ts          (absorbs identity-guard-reads + PrismaVerifiableIdentifierReads)
    identity-projection.prisma.repository.ts     (StateProjectionStore<IdentityFoldState>)
    identity-verification.prisma.repository.ts   (one class; the payload codec stays private)
    identity-backfill.prisma.repository.ts       (reads only)
    identity-users.prisma.repository.ts          (the one user-hash-key write; user-hash-key.ts is deleted)

platform/app/src/server/event-sourcing/pipelines/identity/
  schemas/{constants,commands,events}.ts   framework envelope over the package's payload schemas
  envelope.ts                              identityEvent(command, fact, index): the ONE place aggregateType,
                                           tenantId, idempotencyKey (commandId:index) are stamped;
                                           used by the commands AND by app-layer/identity/ledger.ts
  commands/*.command.ts                    ~20 lines each: the package's guard → envelope
  projections/identity.foldProjection.ts   validate wire event → reduceIdentity
  pipeline.ts                              unchanged shape
```

`IdentityLedgerWriter.commit` takes the old dispatcher's job with its three
foreign ones removed: the command registry is the pipeline's, and the
service locator is the lazy pipeline handle in the same file the authz
ledger keeps its own. Its order is ADR-101 §2's, as revised 2026-08-24 —
append waited → stage → bounded wait for the queue's fold. It never writes
the projection; only the fold does.

**Revised 2026-08-24:** the identity REST family
(`app/api/identity/[[...route]]/app.ts`) is deleted, not thinned. It was a
versioned public API whose only credential was a browser session, which is
the tRPC lane in this product; it had no callers. The surface is
`api/routers/identity.ts` — `protectedProcedure`, `.noPermission()` with the
family's own reason — and `IdentitySessionRequiredError` and the hand-rolled
`sessionAuth` middleware go with it.

`better-auth/index.ts` keeps the stock `prismaAdapter` and binds four
`databaseHooks` to `identityCeremonies()` from the identity runtime; nothing
under `better-auth/` imports `app-layer/identity` internals any more.

`eventIdempotencyKey` moves to
`event-sourcing/commands/idempotencyKey.ts` (the framework owns the
`commandId:index` convention; both pipelines import it from there).

The cached gate (`authz/per-organization-cached-gate.ts`) is generalized
to `_shared/per-subject-cached-gate.ts` as #7333 already does; that
generalization lands as its own commit so the engine gate's change is
reviewable on its own.

### 5. Tests and CI

| Where | What | Lane |
|---|---|---|
| `packages/identity/src/__tests__` | `decide.*` — every refusal and every no-op ("a fact the heads carry is not stated again"); `reduce` replay determinism; `backfill` parity policy; `vocabulary` guards | package `vitest run` |
| `packages/identity-server/src/__tests__` | `IdentityService` over in-memory ports (reads → decision → what `commit` receives); `VerificationCeremonyService` (PKCE, pinning, TTL, unlatched); `IdentityBackfillService` (adopt / detach / held / finalized); the better-auth facade's routing + gate + ceremonies over a fake `base` adapter, with `support/` stubs like `authz-read.stub.ts` | package `vitest run` |
| `platform/app` | thin commands emit under the pipeline's declared aggregate type (`validateEventAggregateType`); `IdentityLedgerWriter` order, budgets, drops, projection-behind repair; the write gate; the routing table pinned against the **live** mounted better-auth surface (this needs the app's config, so it stays here); the RPC; the `/auth/verify-email` page | unit / component |
| `platform/app` (**new**) | every `*.prisma.repository.ts` under `app-layer/identity/repositories/` gets a `*.integration.test.ts` against Postgres — the projection upsert + cursor commit, verification single-use consume, heads reads, backfill reads. This is the largest gap in #7333: no repository has ever run against a database in a test | integration (datastore lane) |

CI: two new shard-1 steps each in `langwatch-app-ci.yml`, next to the
authz ones — `pnpm --filter @langwatch/identity run test` and `run
typecheck`, the same for `identity-server`. The typecheck step is the one
authz forgot; both new packages get it from day one. Biome's scope is
`platform/app/**` by design, so the packages follow the tab-indented
convention of their siblings and are not linted by CI — no change to that
here.

Specs: `specs/identity/identifier-model.feature` keeps its 22 scenarios;
the `@scenario` bindings move with the tests. A new
`specs/identity/identity-packages.feature` states the boundaries as
behaviour (`@unit`, bound to a graph-walking test in the `frontend-boundary`
style): the pure package compiles without node types; identity-server
imports no Prisma, env, or framework module; `better-auth/` reaches
identity only through the runtime; the app has exactly one place that
constructs an `IdentityService`.

### 6. The mapping, file by file

| #7333 file | Becomes |
|---|---|
| `pipelines/identity/projections/identifierIdentity.ts` | split: `identity/identifier.ts` + `identity/vocabulary.ts` (pure) and `identity-server/crypto/identifier-identity.ts` (`deriveIdentifierId`, `computeIdentifierHash`) |
| `pipelines/identity/projections/reduceIdentity.ts` | `identity/reduce.ts` + `identity/facts.ts` |
| `pipelines/identity/schemas/*.ts` | payloads + type strings → `identity/facts.ts`; framework envelope schemas stay, re-composed from the package |
| `pipelines/identity/commands/*.command.ts` (5) | guard bodies → `identity-server/guards.ts`; the files stay as thin handlers |
| `pipelines/identity/commands/identityGuardReads.ts` | port → `identity-server/identity-heads.repository.ts`; `eventIdempotencyKey` → framework |
| `pipelines/identity/commands/identityCommandErrors.ts` | `identity/errors.ts` |
| `app-layer/identity/identity-ceremonies.ts` | `identity-server/identity.service.ts` (verbs) + `app-layer/identity/ledger.ts` (commit) — the class is deleted |
| `app-layer/identity/verification-ceremony.ts` | `identity-server/verification-ceremony.service.ts` + `identity-server/identity-verification.repository.ts` (port) + `identity-server/crypto/pkce.ts` + errors → `identity/errors.ts` |
| `app-layer/identity/identifier-write-gate.ts` | `app-layer/identity/write-gate.ts` + `migration-name.ts` |
| `app-layer/identity/user-hash-key.ts` | deleted; `identity-server/crypto/user-hash-key.ts` (mint) + `identity-users.prisma.repository.ts` (store) |
| `app-layer/identity/migration/identifier-backfill.migration.ts` | policy → `identity/backfill.ts`; orchestration → `identity-server/identity-backfill.service.ts`; a thin `SystemMigration` adapter stays in the app |
| `app-layer/identity/repositories/identity-guard-reads.prisma.repository.ts` + `PrismaVerifiableIdentifierReads` | `identity-heads.prisma.repository.ts` |
| `app-layer/identity/repositories/identity-backfill.prisma.repository.ts` | reads stay; the hash-key write → `identity-users.prisma.repository.ts` |
| `better-auth/identityDatabase.ts`, `identityAdapterContext.ts`, `identityRouting.ts`, `accountCeremonies.ts`, `userCeremonies.ts`, `transactionGuard.ts` | `identity-server/src/better-auth/identity-ceremonies.ts` — one class on better-auth's `databaseHooks`; the routing table, the unrouted-write error, the transaction guard, `findAllRows` and `pinnedToIds` are deleted outright (ADR-101 §2, revised 2026-08-24) |
| `better-auth/secondaryStorageResilience.ts` | deleted (D02 withdrawn 2026-08-24) |
| `app/api/identity/[[...route]]/app.ts` | deleted; the surface is `api/routers/identity.ts` (tRPC), and the session middleware + error class go with it (revised 2026-08-24) |
| `app-layer/system-migrations/runtime.ts` (identity part) | `registeredUserMigrations()` moves to `app-layer/identity/runtime.ts`; the migrations runtime imports it |
| `presets.ts` (identity repositories) | unchanged in role: the projection store and heads repository stay in the repositories bag for the pipeline registry |

### 7. Sequencing

The reshape is mechanical once the packages exist, and every step leaves
the suite green. Six commits, in this order, each reviewable alone:

1. **Framework + shared:** `eventIdempotencyKey` to the framework; the
   cached gate to `_shared/per-subject-cached-gate.ts`.
2. **`@langwatch/identity`:** the package skeleton (copied from
   `packages/authz`), vocabulary, identifier, facts, reduce, errors,
   backfill policy — moved with their tests; the app pipeline re-composes
   its schemas from the package. `decide.ts` lands here with the five
   guards and the commands become thin.
3. **`@langwatch/identity-server`:** skeleton (from `packages/authz-server`),
   ports, `IdentityGuards`, `IdentityService`, `VerificationCeremonyService`,
   `IdentityBackfillService`, crypto, and the better-auth facade under
   `./better-auth` — self-contained and tested before the app touches it.
4. **The app re-point, once:** `identity-ceremonies.ts`,
   `verification-ceremony.ts` and the six better-auth identity modules are
   deleted; `app-layer/identity/{runtime,ledger,write-gate}.ts` appear; the
   pipeline's commands become thin; the migration, the route and
   `better-auth/index.ts` re-point; the cycle is gone. (As landed, steps 2–4
   of the first cut were re-cut so no consumer was edited twice.)
5. **Repository integration tests** for the five Prisma repositories.
6. **Docs:** ADR-101 §1/§2/§6 path references and the §6 sentence "a
   restated fact dedupes at the event store" → "a pass states only what the
   heads do not carry"; D01 and the delivery plan; this ADR to
   Accepted; the two CI steps.

Where the commits land is the one open call: as further commits on
#7333 (the PR is already a merge of main and squash-merges), or as a new
PR off `main` that replaces it. The reshape touches every identity file,
so the diff reads the same either way; a new PR keeps the four CodeRabbit
rounds' history out of the review.

## Rationale / Trade-offs

**Why one `IdentityGuards` class in the server package rather than pure
`decide*` functions in the core?** Because the guard must run on both the
calling path and the staged re-run (ADR-101 §2: veto-before-write is
structural), and it derives identifier ids, which needs node:crypto. A
class over the heads port is callable from both the service and the app's
command handlers, tested once, and sits where `grant-validation.ts` sits for
authz. Pure `decide*` functions would have pushed the read sequencing into
both callers — the duplication the guard exists to prevent.

**Why an `IdentityLedger.commit(command, facts)` port and not a
`Sender<T>` per verb?** The authz package's seam is its write repository
taking an `actor`, with the app's implementation emitting commands. Identity
has one more constraint: the calling path appends the facts itself and
stages the *command* afterwards, so the port must carry both. `commit` is
that contract stated once; the package never sees a queue, a store, or a
projection.

**Why is `identity-server` not browser-evaluable like `authz-server`?**
`authz-server` pays for a `./migration` subpath because `rbac.ts` reaches
its root from the client. No client module reaches identity-server, and the
graph test already fails the build if one does. Paying the subpath cost for
a constraint that does not exist would be copying the letter of the
reference over its reason.

**Why does the migration class stay in the app?** For the reason
`AuthzEngineMigration` does: `SystemMigration` is the runner package's
contract and the package that owns the domain should not couple to the
runner. The service in `identity-server` owns the pass; the app adapter
owns the runner's shape.

**Why not keep it all under `platform/app` with better folders?** Because
folders do not fail to resolve. Every leak the inventory found — the raw
Prisma in `better-auth/`, the cycle, the four composition roots, the
service defaulting to the app's gate — is a wrong-direction import that a
package boundary refuses at the compiler and a folder merely frowns at.

## Consequences

- Two new workspace packages; `platform/app/package.json` gains two
  `workspace:*` dependencies; `langwatch-app-ci.yml` gains four shard-1
  steps.
- `@langwatch/identity` is importable by the frontend, which D13 (sign-in
  and sign-up screens) needs for the provider vocabulary without dragging
  the server graph — the same reason `@langwatch/authz` exists.
- Identity has one composition root. A new consumer of an identity service
  imports it from `app-layer/identity/runtime.ts` or is wrong.
- The reducer, the decisions, the backfill proof and the adapter's routing
  are tested without Prisma, the App, or better-auth mounted; the Prisma
  repositories are tested against Postgres for the first time.
- Behaviour is unchanged: ADR-101's specs still bind 22/22 and the
  Redis-loss specs 4/4 after the move. A scenario that stops binding during
  the reshape is a regression, not a cleanup.

## References

- `packages/authz/`, `packages/authz-server/` — the reference shape
- `platform/app/src/server/app-layer/authz/{runtime,ledger,engine-gate}.ts`
- `dev/docs/adr/101-identity-pipeline-and-identifiers.md`
- `dev/docs/adr/070-modular-package-architecture.md`
- `dev/docs/best_practices/repository-service.md`
- `specs/identity/identifier-model.feature`, `specs/identity/auth-path-redis-loss.feature`
- PR #7333
