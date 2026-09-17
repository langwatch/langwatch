# A composition builder that will not compile without what it needs

**Status: proposed, not agreed.** Measured and prototyped 2026-09-17 on
`feat/strict-feature-layout-v0`. Nothing in the tree implements this yet.

## The defect

`createApp({ role, config, members })` takes its config and its members
**before** `.withModules(...)` says which modules will be installed. At the
point they are supplied the required set is unknown, so nothing can be checked:

- `config` is `Readonly<Record<string, unknown>>` — any object satisfies it.
- `members` is a `MemberSource` built from `Readonly<Partial<Members>>` —
  `membersFrom({})` type-checks.
- a peer a module declares is resolved at boot, so an unsatisfied one is a
  runtime refusal.

Every one of those is a runtime `MissingMemberError` where the compiler had the
information. `reads()` already uses a `const` type parameter, so each module's
reads are a literal tuple and `MembersRead<typeof App.reads>` types the MODULE
side exactly. Only the process side discards it.

This is not hypothetical. `managed-provider` was installed by both processes
with no config slice supplied, because `apiModuleConfig` is a hand-written map
and nobody added the line. It crashed on boot. Under this design it does not
compile.

## The surface

`withModules`, and the two surfaces a process exposes as a matched pair.
Everything the process supplies arrives at `boot`.

```ts
await createApp({ role: "api" })
  .withModules(serverModules)
  .withTransports(apiDoors())
  .withEventing(producersOnly())
  .boot({
    config: apiModuleConfig(config),   // the existing 153-line map, now type-checked
    platform,
    repositories: {
      relational: "postgres",
      analytical: "clickhouse",
      storage: "s3",
      cache: "redis",
    },
  });
```

```ts
await createApp({ role: "worker" })
  .withModules(serverModules)
  .withTransports(closedDoors())
  .withEventing(consumersAndProjections())
  .boot({ config: workerModuleConfig(config), platform, repositories: { ... } });
```

An installation test says the same thing at one module's scale, and needs only
the kinds that module actually uses:

```ts
createApp({ role: "api" })
  .withModules([entitlementServer])
  .boot({
    config: { entitlement: { isSaas: true, processName: "test" } },
    platform: { logger },
    repositories: { relational: "memory" },
    provide: { user: userFixture },
  });
```

## What it refuses, with the compiler's own words

Prototyped and verified; every row is real `tsc` output.

| mistake                             | error                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| member omitted                      | `TS2741: Property 'logger' is missing in type '{ prisma: Prisma; }'`                                                             |
| member wrong type                   | `TS2322: Type 'number' is not assignable to type 'Logger'`                                                                       |
| config slice omitted                | `TS2345: Argument of type '{}' is not assignable to parameter of type '… & { readonly "api-key": { readonly pepper: string } }'` |
| config field wrong type             | `TS2322: Type 'number' is not assignable to type 'string'`                                                                       |
| peer neither installed nor provided | `TS2741: Property 'project' is missing in type '{}' but required in type 'Provide<…>'`                                           |
| provided the wrong implementation   | `TS2741: Property 'getById' is missing in type 'AuthApi'`                                                                        |

Order-independent: a peer satisfied by a later `install`, or provided before the
module that needs it, both compile.

## Decisions taken

- **`members` is renamed `platform`.** Its own doc calls it "the fourteen members
  a process hands its modules", which is exactly what the name never says -
  member of what? See "What `platform` is" below.
- **`withModules` stays.** `install` read better alone but breaks with
  `withTransports` / `withEventing`; one prefix throughout wins.
- **`provide` is keyed, not positional.** `provide: { project: impl }` rather
  than `withProvided(ProjectApi, impl)`. The token is inferred from the key, and
  the error becomes a missing-property error naming the peer instead of
  `This expression is not callable`. A peer is satisfied ONCE per process, so
  the key space is module ids — the same key space `install` uses. `install`
  puts a real module in; `provide` stands in for one that is not installed.
- **Repositories are chosen per KIND**, not per module and not by one global
  switch: `relational` (postgres | memory), `analytical` (clickhouse | memory),
  `storage` (s3 | azure | filesystem | memory), `cache` (redis | memory). The
  tree already sorts them this way — counting backend folders under every
  module's `repositories/` gives prisma 43, memory 41, redis 17, clickhouse 17,
  then s3/azure/filesystem. Required exactly for the kinds the INSTALLED
  modules keep state in, so a test naming one module supplies one kind. This
  replaces `withMemoryRepositories(...)`, its `as Declaration` cast and its
  runtime throw.
- **Transports and eventing are NOT a matched pair.** Considered and rejected on
  measurement. `eventing` is already member 13 of the fourteen, and
  producer-versus-consumer is settled where that member is built
  (`consumersEnabled: false` in `api-eventing.members.ts`; `consumers.enabled`
  in the worker runtime). A `withEventing` on the process builder would be a
  SECOND place to supply it. Transports cannot be a member at all, because the
  host is built from resolved `peers` and so cannot exist before the graph.
  The process keeps `withTransports(host)`; eventing stays a member.
- **A module's transports already live only in the module.** The process-side
  call supplies the HOST they mount in, not a second declaration: internal
  secrets by family, the instance-admin bearer, idempotency, the rate limiter,
  the browser session, the execution proxy. `workerClosedDoors()` is a host
  too, whose `mount()` throws a named refusal rather than returning undefined.
  One word, two things. The process side is renamed `withDoors`, which is the
  word this codebase already uses everywhere: "door" appears 141 times and
  "doors" 58 across the api, worker and runtime-composition sources -
  `workerClosedDoors`, `ClosedDoorMount`, `trpcDoor`, `bearerDoor`,
  `internalDoorFamily`, `DoorContribution`, `ApiRestDoorUnverifiedError`.
  `withTransportSource` would be a fifth word for a thing already named.

  ```ts
  .withTransportAuth((auth) => auth.withStaticTokens({ ... }))   // api
  // worker says nothing: no doors means no doors
  ```

  Saying nothing IS closed doors - the default keeps today's named refusal, so a
  module declaring a REST family in the worker still gets "this role serves no
  HTTP surface" rather than silently mounting nothing.

  `withDoors` takes a FACTORY, `(peers) => hosts`, not a built host: the host is
  assembled from resolved peers, which do not exist until the graph boots. That
  is the same ordering constraint that stopped `members` being checked when it
  was passed before `withModules`. What CAN move is the assembly - the forty
  lines currently inline in the composition root belong in the door package, as
  `openDoors(config)`.

- **Config is supplied at `boot`**, not beside the modules. It is per-module in
  shape, but it is one object the process assembles, and splitting it across
  `withModules` calls would only move the same map.
- **Unknown config keys are dropped, and every drop is logged.** `compileDefinition`
  returns `z.object(shape)`, which STRIPS silently, and `strictObject` appears
  only in `public-app-config.ts`. Measured on the module fixed this morning:
  parsing `{ bedrok: {...} }` against the managed-provider slice succeeds, drops
  the key and defaults `bedrock` to `{}` - a typo would have disabled managed
  Bedrock with no signal. Blanket `.strict()` is the wrong fix: it refuses a
  config carrying a key a newer module version added. Validate, drop, and log
  each dropped key by module and name. A typo in a REQUIRED field still fails
  the parse by itself, so the log is for the rest.
- **Config stays hand-written per process.** Splitting one mega config object
  automatically was considered and rejected on measurement: 23 of the api's 25
  slices are reshaped, not passed through — renamed (`apiKeyPepper` → `pepper`),
  defaulted (`?? {}`), assembled from several places, or conditional. Only
  `feature-flag` and `platform-health` are bare pass-throughs. There is no
  mechanical mapping to derive. Type-checking the map is the win available.

## What the process supplies, refined

The first pass had `platform` (fourteen flat members) beside `repositories`
(four kinds). That is the same four systems named twice: `repositories.relational
= "postgres"` and `platform.prisma = client` are one decision split across two
fields, and nothing stops `relational: "memory"` sitting next to a live Prisma
client. Collapsed, the fourteen fall into three supplied groups and one derived
group, which accounts for all of them.

Almost nothing is supplied by hand. `createProcessMembers` already builds every
member from config - measured: `apps/api` passes exactly ONE explicitly
(`eventing`), and prisma, clickhouse, redis, object storage, logger, clock,
secrets, encryption, telemetry, cache, rate limiter and mail all come from
`processConfig`. So a `with*` store call is an OVERRIDE, not the normal path, and
the production chain is short.

The shape is fluent throughout and `boot()` takes no arguments at all. Important
things stay at the root - modules, config, secrets, encryption, environment - and
the plumbing folds into one call whose callback is inferred:

```ts
await createApp({ role: "api" })
  .withModules(serverModules)
  .withEnvironment(processConfig)
  .withConfig(apiModuleConfig(config))
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withFacilities((f) => f.withLogger(logger).withMetrics(metrics).withTracing(tracer).withClock(clock))
  .withTransportAuth((auth) => auth.withStaticTokens({ ... }).withBrowserSession(...))
  .boot();

// a test overrides a store; production never names one
  .withRelational(memory())
```

A store call takes the client itself or `memory()` - there is no `postgres(...)`
tag, since `PrismaClient` and `ClickHouseQueryClient` are already distinct types
and the tag told the compiler nothing. There is no second field naming a tier
either, so `memory()` cannot sit beside a live client.

What the facilities callback supplied is INFERRED and subtracted from what is
still outstanding: supplying the wrong one leaves `MustSupply<"clock">` standing.

**Derived, and therefore having no call at all.** `cache` and `rateLimiter` are
built over `keyValue`. `idempotency` is built over `relational` and `encryption`:
`IdempotencyLedger.create({ receipts: members.read("prisma"), cipher:
members.read("encryption") })` at `api-production.composition.ts:234`.

Idempotency is NOT a cache, and the difference is load-bearing. Its receipts are
a durable ledger on a `scopeId_key` compound unique constraint, and each row
carries `claimId`, `heartbeatAt` and `expiresAt` - a LEASE. An in-flight request
holds a claim and heartbeats it, which is how a retry sent while the original is
still running is refused 409 rather than duplicated. A cache may evict whenever
it likes and nothing breaks; evicting a receipt re-runs the create, which is the
double-charge the feature exists to prevent.

4 + 2 + 5 = 11 supplied, 3 derived, and the separate `repositories` field is gone.

Which calls are REQUIRED is computed from the installed modules, and `boot` is
callable only once none is outstanding. Measured: a graph installing three
modules and supplying nothing reports every gap in one type -

```
Type 'MustSupply<"analytical" | "config" | "keyvalue" | "logger" | "relational">'
  has no call signatures.
```

and a process installing only modules that keep no analytical state is never
asked for `withAnalytical` at all.

## Three findings from working the shape through

**Environment is a tier, and belongs in config.** `local` / `development` /
`production` is already the `ENVIRONMENT` leaf of `runtimeIdentityConfigDefinition`.
It needs no call.

**Tracing is a BACKEND choice, not a facility handed over.** Which of otel or
something else carries logs, traces and profiles is the same kind of decision as
which backend a store uses, so it belongs with logging and metrics under one
observability call.

**`telemetry` is misnamed, and tracing is missing.** The member is
`count(name, value?, attributes?)` and `observe(...)` - metrics and nothing else.
A module that wants a span has no declared way to get one: it reaches the global
OTel tracer as an undeclared dependency, or it does without. Rename the member
`metrics`, and add `tracing` as its own.

**The builder needs the PROCESS config, not just the module slices.** Stores are
built from connection strings, and `ENVIRONMENT` / service name / service version
are `runtimeIdentityConfigDefinition` leaves that never reach `create-members`.
Those are two different inputs and conflating them was an error in the first
pass:

```ts
.withEnvironment(processConfig)        // ENVIRONMENT, service name, DATABASE_URL, ... - builds the stores
.withConfig(apiModuleConfig(config))   // the per-module slices
```

**Choosing memory while a real endpoint is configured is worth a warning.**
`withRelational(memory())` with `DATABASE_URL` set means the deployment named a
database and the process is ignoring it - which is right in a test and a mistake
anywhere else, and silent either way today. Warn at boot naming both facts, the
same shape as the dropped-config-key log.

## The three processes, whole

```ts
// apps/api
await createApp({ role: "api" })
  .withModules(serverModules)
  .withConfig(apiModuleConfig(config))
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withObservability((o) => o.withLogging(pino).withTracing(otel()).withMetrics(otel()))
  .withTransportAuth((a) => a
    .withStaticTokens({ cron, langyInternal, instanceAdmin })
    .withBrowserSession(session))
  .boot();

// apps/worker - the same, minus the doors. That IS the difference between the roles.
await createApp({ role: "worker" })
  .withModules(serverModules)
  .withConfig(workerModuleConfig(config))
  .withSecrets(secrets)
  .withEncryption(cipher)
  .withObservability((o) => o.withLogging(pino).withTracing(otel()).withMetrics(otel()))
  .boot();

// an installation test - only what its one module declares
await createApp({ role: "api" })
  .withModules([entitlementServer])
  .withConfig({ entitlement: { isSaas: true, processName: "test" } })
  .withRelational(memory())
  .withObservability((o) => o.withLogging(testLogger))
  .provide({ user: userFixture })
  .boot();
```

Stores never appear in production: they are built from the connection strings in
config, and a `with*` store call is an override.

### apps/ui is not on this shape, and that is its own piece of work

`modules/web-modules.generated.ts` reads "No module declares a web half yet" and
exports `[]`, so the catalogue-driven path is unwired. What runs is
`collectWebInstallations({ installations: features })` over a hand-listed array,
merged with `installedLegacyUiFeatures`, and a `WebInstallation` is
`{ name, install(ui) }` - an imperative install rather than a declaration. The
equivalent shape would be

```ts
createUi().withModules(webModules).withSession(useBrowserUiSession).boot();
```

but reaching it needs every web half to declare itself in the catalogue and the
legacy merge to go. Bigger than it looks, and separate from the server builder.

## Where a thing goes, with fifty modules installed

The difficulty at fifty is not the count, it is knowing where each thing belongs.
Five categories, one question each, and exactly one field per category in the
supply so nothing free-floats:

| the module needs | it declares | the process supplies it as |
| --- | --- | --- |
| state it owns | a repository | a **store** kind |
| another module's capability | `static dependencies` | installing that module, or `provide` |
| a process facility | `reads(...)` | `facilities` |
| a setting | a config slice | `config` |
| messages to something it does not own | a channel | a **channel** kind |

And at that size the supply is not hand-written. `boot({})` and the compiler
prints the whole index in one pass - measured on the generated 49-module graph:
TWO errors, each complete, naming every missing config slice and every missing
member rather than stopping at the first.

The per-module config intersection must be flattened for that to be readable.
Raw, it prints as `EmptyConfig & { m00: ... } & { m03: ... } & ...`; wrapped in

```ts
type Simplify<T> = { [K in keyof T]: T[K] } & {};
```

it prints as one object and the error becomes `TS2740: Type '{}' is missing the
following properties: m00, m03, m06, ...`, the same readable form the members
error already has.

## Why `provide` exists at all, and why it should not

A peer should be satisfied by installing the module that owns it. In production
exactly one token is not: `ActivatedLicenseSource`. It is declared

```ts
export const ActivatedLicenseSource = moduleApi<EntitlementSource>("licensing");
```

in `modules/entitlement/contract`, while the licensing module's own contract is
`LicensingApi = moduleApi<LicensingApi>("licensing")`. Two different APIs under
one module id. No collision at runtime — a token's identity is the frozen object,
not its name — but no module declares `ActivatedLicenseSource` as its contract
either, so the process hand-builds it with `createActivatedLicenseSource(...)`,
the licensing module's own factory, and provides it.

It borrowed that id because `ModuleName` is a closed union generated from the
catalogue: there was no other legal name. So the fix is not a rename. Either
licensing provides it through installation, or it stops being a `moduleApi`
token and becomes what it actually is — a port the process composes, in a
category of its own.

Until then `provide` stays, keyed by id. Keying by id is only sound once one id
means one API, which this token currently breaks: a lint rule has to enforce it.

## A separate fix the same principle asks for

`ApiRestHostConfig` declares every field optional, and the composition root
assembles it with conditional spreads:

```ts
...(idempotency ? { idempotency } : {}),
...(rateLimiter ? { rateLimiter } : {}),
...(options.browserSession ? { browserSession: options.browserSession } : {}),
```

Dropping any of them compiles. Worse, `?` cannot tell the two kinds of absence
apart: `instanceAdminKey` is "absent where unconfigured or SaaS", a legitimate
choice, while an absent `browserSession` means the door mounts and answers 401
to every signed-in caller. Same annotation, opposite meanings, neither stated
where a reader would look.

Auth is configured on the app builder itself, through a callback. There is no
door object to construct and pass:

```ts
.withTransportAuth((auth) => auth
  .withStaticTokens({ cron, langyInternal, instanceAdmin })
  .withBrowserSession(browserSession))
```

Calling it is what opens this process's doors; a process that says nothing opens
none, so the worker simply omits it. Both inner calls are optional because both
fail CLOSED: an absent instance-admin bearer refuses that door, an absent session
still mounts the routes and answers 401. Forgetting either locks people out,
which is loud.

Static tokens are NAMED rather than the open `Record<string, string | undefined>`
they are today: every one is `null` tier in `DOOR_SCOPE_TIER` - nobody's tenant -
and a mistyped family key in an open record guards nothing while looking
configured. Named, a typo is `TS2561: 'langyInternl' does not exist`.

A browser session is its own call rather than a leaf of some `auth` group: a
cookie and a deployment's shared bearer are different mechanisms, and grouping
them invites an "auth set, session not" state that means nothing.

**Limiting and idempotency are NOT door-builder calls.** Both were proposed and
both were wrong, on measurement:

- `idempotency` and `rateLimiter` are members 11 and 12 of the fourteen. The api
  derives each from the member record already - `apiIdempotencyLedger({ config,
  members })`, `apiRateLimiter({ config, members })` - so a builder call would be
  a second place to supply what a member already carries.
- Neither fails open. Idempotency is opt-in PER ROUTE, and a route that opts in
  where the runtime has no port throws at mount: "declares itself replayable
  under a caller's key, and this runtime supplied no idempotency port to keep
  its receipts" (`runtime.ts:385`). It is one of a family - entitlement and
  audit refuse the same way. Declared-and-missing is already loud.

So the type-state machinery for the door builder is unnecessary, and the phantom
-parameter trap with it.

Idempotency was reviewed rather than assumed, and it holds up: `scopeId` is "the
tenancy the key is unique within: a project id or an organization id", taken from
the scope access already resolved rather than from the caller; storage is keyed on
a compound `scopeId_key` unique constraint; the operation is folded into the
fingerprint so one key cannot answer two different creates; the same key with a
different body is refused 409; only successful responses are stored; and
`declaration.ts:1559` refuses idempotency on a `public` route outright, because a
route with no resolved scope has no tenancy for a key to be unique within.

Independent of the builder; it can land first.

## The one prerequisite

`moduleApi<Api>(name: ModuleName): ModuleApiToken<Api>` erases the name, so
peers cannot be subtracted from requirements. It must carry the id:

```ts
export const ProjectApi = moduleApi<ProjectApi>()("project");
```

TypeScript will not infer `Id` while `Api` is explicit, so it curries. ~50
declaration sites, one regex codemod: `moduleApi<X>(ID)` → `moduleApi<X>()(ID)`.

## Scale

Verified against a generated 49-module graph — 17 config slices, 4 members, 10
peer edges — matching the real `serverModules` shape (which is already
`as const`, so element types survive). Compiles clean in ~0.8s of `tsc` work,
and still refuses a missing slice, a missing member and an unsatisfied peer at
that size. One wrinkle: removing a module while leaving its config slice reports
the stale config key first and the missing peer second. Correct, indirect.

## What this deletes

`withModules`, `withProvided`, `withInfrastructure`, `withPersistence`,
`withMemoryRepositories`, `membersFrom`, the process-side `withTransports`, the
conditional-`boot` trick, and the role-driven implicit eventing branch.

## Two rules the lint must hold

**One module id, one API.** `provide` is keyed by module id, which is only sound
while an id names a single API. `ActivatedLicenseSource` breaks it today, being
`moduleApi<EntitlementSource>("licensing")` beside the licensing module's own
`moduleApi<LicensingApi>("licensing")`. A rule must refuse a second token under
an id another token already claims.

**A composition file imports installers, config and the builder - nothing else.**
`private-runtime-export` polices what a module's barrel offers; this is the same
boundary from the consumer's side, and it is what stopped the worker hand-building
persistence for a module it had already installed. A composition root reaching for
a repository, a service or an adapter is the defect that produced eight graphs and
forty-six stitches.

**Documentation shows only the shape that exists.** The spellings that no longer
do live in the lint, not in prose - a reference that lists them puts the deleted
names in front of the next reader.

## Cost

3 composition roots, ~40 installation tests (both just move arguments), ~50
token declarations (codemod), and the builder itself. Then the lint rule,
CLAUDE.md and the architecture guide, so lint drives the remainder.
