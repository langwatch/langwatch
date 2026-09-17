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

## What `platform` is

The fourteen, by what they are rather than by construction order:

| | member | what it is |
| --- | --- | --- |
| utilities, no connection | `logger` `clock` `secrets` `encryption` `telemetry` | the process's own facilities |
| connections | `prisma` `clickhouse` `objectStorage` `redis` | one client each to an external system |
| built over redis | `cache` `idempotency` `rateLimiter` | policy layers, not stores |
| built over the rest | `eventing` `mail` | outbound channels |

Four properties define the set, and they are why it deserves one name:

1. **One instance per process**, shared by every module. Never per-module.
2. **A lifecycle**: built at boot in dependency order, closed in reverse. The
   order in `MEMBER_NAMES` is load-bearing and asserted by that package's own
   tests - `prisma` precedes `clickhouse` and `objectStorage` because both route
   through its directory read, and `redis` precedes everything built over it.
3. **Technical, not domain.** Not one of them knows what a project or a trace is.
4. **Rationed by declaration.** A module is handed only the names it put in
   `reads(...)`, so one that never named a client cannot reach for one.

`platform` is also sharp by exclusion, which `members` never was. A peer module's
API is `provide` and `dependencies`. A store is `repositories`, chosen by kind. A
module's own settings are `config`. A door is `withTransportAuth`. Nothing else
in the surface overlaps it, and `apps/api/src/platform/` is already where these
are composed.

`clients` would fit prisma, redis and clickhouse but not clock, secrets or
encryption; `services` collides with a module's own; `infrastructure` is the word
ADR-144 retired.

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

## Cost

3 composition roots, ~40 installation tests (both just move arguments), ~50
token declarations (codemod), and the builder itself. Then the lint rule,
CLAUDE.md and the architecture guide, so lint drives the remainder.
