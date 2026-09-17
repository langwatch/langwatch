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
    config: apiModuleConfig(config),
    members,
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
  .boot({ config: workerModuleConfig(config), members, repositories: { ... } });
```

An installation test says the same thing at one module's scale, and needs only
the kinds that module actually uses:

```ts
createApp({ role: "api" })
  .withModules([entitlementServer])
  .boot({
    config: { entitlement: { isSaas: true, processName: "test" } },
    members: { logger },
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
  One word, two things - that collision is worth renaming, not removing.
- **Config is supplied at `boot`**, not beside the modules. It is per-module in
  shape, but it is one object the process assembles, and splitting it across
  `withModules` calls would only move the same map.
- **Config stays hand-written per process.** Splitting one mega config object
  automatically was considered and rejected on measurement: 23 of the api's 25
  slices are reshaped, not passed through — renamed (`apiKeyPepper` → `pepper`),
  defaulted (`?? {}`), assembled from several places, or conditional. Only
  `feature-flag` and `platform-health` are bare pass-throughs. There is no
  mechanical mapping to derive. Type-checking the map is the win available.

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

The door's own package should own an exhaustive constructor where absence is a
named value - `unthrottled()`, `notConfigured()` - so a field cannot be
forgotten and a reviewer reads the decision instead of noticing a missing key.
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
