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

Three calls. `install` takes the modules and the config for those modules,
because config is per-module. Everything at `boot` is process-wide.

```ts
await createApp({ role: "api" })
  .install(serverModules, apiModuleConfig(config))
  .boot({
    members,
    provide: { activatedLicenseSource: licenseSource },
    transports: apiDoors(),
    eventing: producersOnly(),
  });
```

```ts
await createApp({ role: "worker" })
  .install(serverModules, workerModuleConfig(config))
  .boot({
    members,
    provide: { activatedLicenseSource: licenseSource },
    transports: closedDoors(),
    eventing: consumersAndProjections(),
  });
```

An installation test says the same thing at one module's scale:

```ts
createApp({ role: "api" })
  .install([entitlementServer], { entitlement: { isSaas: true, processName: "test" } })
  .boot({ members: { logger }, provide: { user: userFixture }, repositories: "memory" });
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

- **`install` / `provide`**, not `withModules` / `withProvided`.
- **`provide` is keyed, not positional.** `provide: { project: impl }` rather
  than `withProvided(ProjectApi, impl)`. The token is inferred from the key, and
  the error becomes a missing-property error naming the peer instead of
  `This expression is not callable`. A peer is satisfied ONCE per process, so
  the key space is module ids — the same key space `install` uses. `install`
  puts a real module in; `provide` stands in for one that is not installed.
- **`repositories: "live" | "memory"`, one switch**, replacing the per-module
  `withMemoryRepositories(...)` wrapper and its runtime throw. A per-member
  sentinel (`prisma: memory, clickhouse: real`) was considered and deferred:
  `defineRepositories({ live, memory })` is two whole bundles per module, so a
  module mixing Prisma and ClickHouse stores cannot honour a split today.
- **`transports` and `eventing` are a matched pair**, both named at boot.
  Today `role` decides implicitly (`feature-installer.ts:776-787` branches on
  `args.role === "worker"` / `"api"`), so nothing at the call site says which
  halves run. After this, `role` names the process and decides nothing.
- **Config stays hand-written per process.** Splitting one mega config object
  automatically was considered and rejected on measurement: 23 of the api's 25
  slices are reshaped, not passed through — renamed (`apiKeyPepper` → `pepper`),
  defaulted (`?? {}`), assembled from several places, or conditional. Only
  `feature-flag` and `platform-health` are bare pass-throughs. There is no
  mechanical mapping to derive. Type-checking the map is the win available.

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
