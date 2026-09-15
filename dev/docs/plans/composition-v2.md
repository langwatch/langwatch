# Composition v2: the declarative process

The design is [ADR-144](../adr/144-declarative-process-composition.md). This is
the build order, the exact types, and the recipe a conversion lane follows.

## What dies

| File or symbol | When |
| --- | --- |
| `apps/api/src/features/<m>/<m>.composition.ts` (`installApi<M>`) | as `<m>` converts |
| `apps/api/src/features/<m>/<m>-rest.mount.ts`, `<m>-trpc.mount.ts` | as `<m>` converts |
| `apps/api/src/features/<m>/<m>-absence.ts`, `<m>.composition.types.ts` | as `<m>` converts |
| lines naming `<m>` in `api-production.composition.ts`, `app-trpc.features.ts`, `api-rest.doors.ts` | as `<m>` converts |
| `apps/api/src/app/api-production.composition.ts` (4,989 lines) | when the last module converts |
| `apps/worker/src/app/worker-production.composition.ts` (2,530 lines) | when the last module converts |
| `apps/api/src/app-rest/api-rest.doors.ts` (909 lines) | with `api-production` |
| `<M>Infrastructure` interfaces, `createTestInfrastructure`, `createTestApp`, any "fakes" bag | as `<m>` converts |
| `.needs<I>()(...)` and `Needs<...>` | already dead - never built this way; see below |
| `withPersistence`, `persistenceFor`, `pool.prisma === undefined ? "memory" : "postgres"` | as `application.ts` is rewired onto `@langwatch/infrastructure` |
| `defineModule`, `serverFeature`, `ServerFeatureBuilder.build()` | step 2 |
| `contributesWorkerWork` | step 2 |
| every `refusing<M>Feature` and `Logged<M>Absence` | as `<m>` converts |

**`FeatureInstallOptions.rest.onError` does NOT die.** It survives, renamed
where it moves: a legacy family's wire error shape is a customer-visible
contract, and the api-key conversion showed that deleting the handler rather
than moving it silently rewrites what an existing integration parses. See
"Family-level `onError`" under step 4 and ADR-144 decision 4. This row was
wrong in the first draft of this plan; the correction below (under "What
converting annotation and api-key found") is what actually happened, and this
table is now consistent with it.

## What is landed already (2026-09-10, end of day)

The member record itself is built, tested and unconnected to any module:

- `@langwatch/infrastructure` (`packages/infrastructure/src/`): `ProcessMembers`
  (fourteen members), `MemberName`, `reads(...names)`, `MembersRead<Names>`,
  `createProcessMembers({ config, members? })` returning a `MemberSource` that
  builds each member eagerly on first read in one fixed order (`MEMBER_NAMES`),
  refuses an unconfigured member by name (`MemberNotConfiguredError`) and
  refuses a member handed in as `undefined` (`MemberSuppliedUndefinedError`).
  The discriminated `MailConfig` (`smtp | ses | resend | off`), the
  ClickHouse/object-storage tenant directory built once over `prisma`, and the
  Redis-backed `cache` / `idempotency` / `rateLimiter` trio are all here and
  unit-tested (`packages/infrastructure/tests/infrastructure-pool.unit.test.ts`).
- `@langwatch/runtime-composition/src/module-members.ts`: the attribution
  layer over a `MemberSource` - `MemberClaim { module, members }`,
  `buildClaimedMembers({ source, claims })` (builds exactly the union of
  claimed names, in the source's order, wrapping a member-only refusal as
  `MissingMemberError { module, member, cause }`), and `membersFor(members,
  names)` (the per-module slice). This file is imported by `application.ts`
  but not yet called from it - see the gap below.
- `packages/eventing/src/pipeline/eventingModule.ts`'s `defineEventingModule`
  and `.withEventing(...)` on the module builder, landed at c747279e4e and in
  production use by `apiKeyServer`. This is the one channel-shaped seam
  actually built; see ADR-144 decision 9.
- `dev/scripts/generate-modules.mjs` (`pnpm generate:modules`), reading
  `modules/catalogue.json`'s `tier` field and writing
  `modules/server-modules.generated.ts` and `modules/web-modules.generated.ts`,
  both checked in and both including every present module (annotation and
  api-key among them). No process root imports either file yet.
- `.withCredential(kind)` (family default and per-route), `.withAudit(action)`
  with `assertAuditAction`'s dotted-lower-kebab check, and the REST address
  inventory (`apps/api/src/app-rest/api-rest.addresses.json` plus its
  snapshot test) - all landed in `@langwatch/api` and in real use by a dozen
  modules including the two converted ones.
- `annotationServer` and `apiKeyServer` themselves: both declared with
  `defineServerModule(...).withRepositories(...).withApp(...).withTransports(...)`
  and, for api-key, `.withEventing(...)`, ending the chain with no `.build()`.
  **Neither declares a `static readonly reads`, because neither needs a
  member**: both read only their own repositories and their peers' Apis. There
  is no landed example yet of a module actually naming a member with
  `reads(...)`.

**The gap between these two facts is the real state of the implementation.**
`@langwatch/runtime-composition/src/application.ts` and `src/tiers.ts` still
carry the design this plan's first draft, and ADR-144's first draft, were
written to replace:

- `tiers.ts` exports `Tier = "live" | "memory"`, and `ApplicationOptions`
  takes `repositories: Tier` and `channels: Tier` as required fields -
  precisely the `repositories: "live" | "memory"` argument ADR-144 decision 2
  says cannot exist.
- `application.ts`'s `boot()` calls `assertInfrastructure(...)` and reads
  `declaration.requiredInfrastructure`, neither of which is imported at the
  top of the file, and neither of which exists anywhere in the package - there
  is no `infrastructure-needs.ts` in the tree. This line does not currently
  compile.
- `application.ts` imports `buildClaimedMembers` and `membersFor` from
  `module-members.ts` and never calls either.
- `persistenceFor(members)` still reads `pool.prisma === undefined ? "memory"
  : "postgres"` - the exact inference ADR-144 decision 2 refuses.
- `packages/runtime-composition/tests/infrastructure-needs.unit.test.ts` still
  exercises the discarded `.needs<I>()(...)` / `.build()` shape against
  `createApp({ role, infrastructure: {...} })`, a signature `application.ts`
  no longer has (it takes `members: MemberSource<Members>`, not a plain
  `infrastructure` object, and requires `repositories` / `channels` the test
  does not pass). This test is stale, not a second source of truth.
- `packages/test-harness/src/infrastructure-doubles.ts` imports fake builders
  (`fakeClock`, `memoryCache`, …) from a sibling `./members.ts` that does not
  exist in `packages/test-harness/src`.

None of this is a second design to reconcile: `@langwatch/infrastructure` is
what ADR-144 describes, and the above is unfinished wiring plus stale fixtures
left behind by the rulings that discarded the earlier shape. Rewiring
`application.ts` onto `@langwatch/infrastructure` - deleting `Tier`, deleting
`persistenceFor`, calling `buildClaimedMembers` for real, and repointing or
deleting the stale test - is the next slice, and nothing after it in this plan
can be attempted before it lands.

## What is built, in order

### Step 1 - the member record

`packages/infrastructure/src/members.ts` and `create-members.ts`, landed as
described above. Nothing here opens a socket or names a vendor SDK beyond a
type import, so a module server package that imports `reads` and `MemberName`
pulls in no client library; construction lives behind `createProcessMembers`,
which does.

`packages/test-harness/src/infrastructure-doubles.ts` holds individual honest
fakes - `fakeClock()`, `memoryCache()`, and their kin - each handed to
`createApp({ members: { clock: fakeClock() } })` one at a time. There is no
single `createTestInfrastructure()` that assembles all fourteen at once: a
test names the members its subject reads and gets real, config-built members
for the rest, which is the same seam production uses, not a parallel one. (Its
own import of a sibling `members.ts` needs fixing before this is usable; see
the gap above.)

### Step 2 - `defineServerModule` and the App's own `reads`

`packages/runtime-composition/src/feature-installer.ts` already exports
`defineServerModule` (the canonical name; `defineModule` still answers until
every module is repointed) and `ServerModuleBuilder`'s chain -
`.withRepositories`, `.withApp`, `.withTransports`, `.withWorkers`,
`.withTasks`, `.withEventing` - each returning something already installable.
There is no `.build()`, and neither converted module calls one.

What is **not** built this way, and never will be, is a `.needs<I>()(...)`
call on that chain. ADR-144's first draft proposed it; both reviews rejected
it in favour of ruling 14 - a member set is stated once, on the App, with
`static readonly reads = reads("clock", "logger")` - because inference from
`keyof create(setup)` cannot give boot the member names at runtime, and a
misspelt member in a curried builder call used to fail several calls later
(`Property 'withRepositories' does not exist on type [...]`) rather than on
the line that named it. `reads(...)` types the tuple directly against
`MemberName`, so the failure is immediate and the line is not.

`ModuleSetup<Dependencies, Repositories, Reads>` - the type an App's `create`
takes, built from its own `dependencies`, its repository registry, and its
own `reads` tuple - is named in ADR-144 and does not exist in the tree yet.
Building it, and wiring an App's `static readonly reads` into what
`application.ts` claims per module, is part of the rewiring step above.

### Step 3 - `createApp`

`packages/runtime-composition/src/application.ts`, once rewired:

```ts
export function createApp(options: {
  role: ServerRole;                                  // "api" | "worker" | "tasks"
  config: Readonly<Record<string, unknown>>;
  members?: { readonly [N in MemberName]?: ProcessMembers[N] };
}): ApplicationBuilder;

class ApplicationBuilder {
  withModules(modules: readonly InstallableServerModule[]): this;
  boot(): Promise<BootedRuntime>;
}
```

There is no `repositories: Tier` or `channels: Tier` parameter: a repository's
backend is chosen per module, per repository, from whether the member it
needs is present (decision 2), never from one process-wide word. `role` and
`config` are on `createApp` itself, not on `boot()`, so a builder cannot be
half-configured and `boot()` takes nothing. `withModule` (singular),
`withInfrastructure`, `withPersistence` and `withProvided` are gone; a module
wanting a peer names its token in `static dependencies` instead (and decision
7's open peer-seam gap is what still has to answer how a *test* supplies one
without booting the peer's whole graph).

Boot order:

1. `buildClaimedMembers` over every installed module's `reads`, plus the
   chosen repository tier's own requirements, before any `create` runs.
2. providers, duplicate names, missing peers, cycle.
3. topological order, then `create` per module, each handed `membersFor(...)`
   sliced to exactly what it claimed.
4. role contributions: `api` mounts transports, `worker` starts workers,
   `tasks` registers the invoked tasks only (decision 1's `defineTask(...)`).
5. services start, then hosts open.

### Step 4 - the REST declaration

Landed:

- per-route `.withCredential(kind)` on `RouteBuilder`, defaulting to the
  family's kind, retyping `actor` and `scope` through `DOOR_SCOPE_TIER`, in
  real use across a dozen modules.
- `.withAudit(action)` on `RouteBuilder`, `assertAuditAction`'s
  dotted-lower-kebab check, recorded in `RouteState.audit` and written by the
  runtime after a 2xx or a refusal.

Not landed:

- the REST runtime still cannot resolve a credential *object* for a route - a
  family asking whether the key itself (not just its holder) may act
  organization-wide still binds that fact with `bindRestMiddleware`. `api-key`
  is the one module this blocks; every other converted module is unaffected.
- `.withAudit` on the tRPC declaration. Check for a redaction fix before
  asking for it - see "What converting found" below.
- `FeatureInstallOptions.rest.onError` is not deleted (see "What dies" above);
  a legacy wire shape moves into the module's own transport file instead.

### Step 5 - the generator

`dev/scripts/generate-modules.mjs`, run by `pnpm generate:modules` and by
`start:prepare:files`, reads `modules/catalogue.json`:

```jsonc
{ "id": "api-key", "root": "modules/api-key", "classification": "core",
  "tier": "core", "subjects": ["api-key"] }
```

and writes, checked in:

- `modules/server-modules.generated.ts` -
  `export const serverModules = [agentServer, analyticsServer,
  annotationServer, apiKeyServer, …] as const;`
- `modules/web-modules.generated.ts` - the same for the web half.

This landed at a different location than either document originally said:
both files live in `modules/`, next to the catalogue, not under
`packages/runtime-composition/src/` or `apps/ui/src/features/`. `tier:
"enterprise"` entries are emitted only in the enterprise build
(`LANGWATCH_BUILD_TIER=enterprise`), so the OSS output has no enterprise
import at all. No test yet asserts a fresh run equals the checked-in file, and
no process root imports `serverModules` - the generator is proven in
isolation, not in the boot path.

`classification` and `tier` currently name the same split on every catalogue
entry and have not been folded into one field; `classification` is what
architecture-enforcer's existing policies read, `tier` is what the generator
reads.

### Step 6 - the address inventory

Landed. `apps/api/src/app-rest/api-rest.addresses.json`, generated from the
mounted declarations, and
`apps/api/src/app-rest/__tests__/api-rest.addresses.snapshot.integration.test.ts`
comparing a fresh generation against the checked-in file. A conversion that
moves a route or changes a door fails it.

## The transition

`createApp`'s REST runtime mounts on the same Hono root
`api-production.composition.ts` uses, so both paths serve at once and a module
moves between them without a wire change - once step 3's rewiring lands; today
neither `apps/api` nor `apps/worker` boots through `createApp` with a
generated module list at all.

Per module, in one lane, one commit:

1. `api-production.composition.ts` loses the module's lines.
2. `apps/api/src/features/<m>/` is deleted.
3. `modules/<m>/server/src/<m>.server.ts` gains `static readonly reads =
   reads(...)` on its App, only where the App genuinely reads a member -
   annotation and api-key needed none.
4. the address inventory is regenerated and reviewed as a diff of **zero**
   lines.

`api-production.composition.ts` never grows. A lane that needs it to grow has
found a gap in the primitives and reports it instead.

## Per-module conversion recipe

A Sonnet lane follows this and nothing else.

1. Read `modules/<m>/server/src/<m>.server.ts` and
   `apps/api/src/features/<m>/*` - that directory is the whole list of what the
   process does for this module.
2. Delete `<M>Infrastructure`. Its members become named keys of the parameter
   `<M>App.create` takes, beside `repositories` and `dependencies`. Each old
   member goes to exactly one of four homes, in this order of preference:
   - **derived in `create`** from what the module already has (annotation's
     logger, api-key's ksuid binding-id generator and its warning log);
   - **asked of a peer** through its `<F>Api` token, where the peer owns the
     answer (api-key's binding-id derivation is `authorization.deriveGrantId`,
     because a second copy of a deterministic id derivation drifts and writes
     rows the revocation queries never find);
   - **the module's own config slice**, where the value has an environment
     binding the module already declares - give the App a `static readonly
     configSchema` and read `setup.config` (api-key's `API_KEY_PEPPER`);
   - **a named member**, stated with `static readonly reads = reads(...)`
     on the App, and only then.
   A member that fits none of the four is a finding to report, not a member to
   invent. Annotation and api-key both landed with an empty `reads` - naming a
   member at all is the exception, not the default step.
3. Name the declaration with `defineServerModule` and end the chain on the
   last `with*` call it needs. There is no `.build()` and no separate
   `.needs(...)` step: naming a member the record does not have is a compile
   error on the App's own `reads` line, which is where the member set is
   stated.
4. Move each mount-side credential binding onto its route as
   `.withCredential(kind)`; the family default stays on the router.
5. Move each mount-side audit middleware onto its routes as
   `.withAudit("<action>")`, one per audited method, and list the old actions
   in the report. Renaming to dotted-lower-kebab is mandatory
   (`assertAuditAction`) and changes what the trail records - state that
   change, do not let it be discovered later.
6. Move idempotency, rate limit, cache and body limit the same way.
7. The family `onError` MOVES, it does not die. Export the renderer from the
   module's own transport file beside the declaration (`annotationRestErrors`
   beside `annotationRest`) and hand it to `runtime.mount`. Deleting it
   instead silently rewrites what a customer's integration parses.
8. Delete `apps/api/src/features/<m>/` and the module's lines in
   `api-production.composition.ts`, `app-trpc.features.ts` and
   `api-rest.doors.ts` (hand these lines to the coordinator, do not edit them
   in a shared lane). **This step cannot run before `application.ts` is
   rewired onto `@langwatch/infrastructure` and mounts a module's declared
   transports on the same Hono root the process serves from** - today that is
   not yet true, so deleting the module's installer would take the family off
   the wire. Before then a lane shrinks those files only by what the module
   actually took over - an audit middleware, a bound error renderer - and
   reports the rest as queued.
9. Move every conduit out of the services. Run
   `go run ./tools/shapemod channels modules/<m>` for the candidate list, then
   for each one: declare the interface in the module's own message types at
   `channels/<subject>.channel.ts`, move the implementation to
   `channels/<tier>/<tier>.<subject>.channel.ts` (`eventing`, `redis`, `http`,
   `sqs`, `ses`, `slack`), write its memory twin under `channels/memory/`, and
   register both in `channels/<m>-channels.registry.ts` with
   `defineChannels({ live, memory })`. The service takes the channel interface;
   it imports no bus, no pub/sub and no HTTP client
   (`service-does-not-open-a-channel`). No module has done this yet - the
   annotation and api-key conversions found nothing to move, because neither
   opens a channel today.
10. Point the module's tests at the SAME `createApp` production uses, handing
    in any member the test cares about by name (`fakeClock()`, `memoryCache()`
    from `@langwatch/test-harness`, not a bag that builds all fourteen).
    Memory for a repository is asked for by name on `.withRepositories(...)`;
    it is never a default and never what a missing database falls back to.
    **Open**: a peer Api is not a member, so no named argument on `createApp`
    answers `ProjectApi`. Installing the peer's module instead installs its
    peers after it (annotation names five; api-key names three; the chain
    reaches the authz ledger), which is no longer a unit test. The seam that
    hands one peer's Api in by its token has to survive whatever
    `withProvided` is renamed to.
11. Run `rtk pnpm --filter @langwatch/<m>-server test:unit`, regenerate the
    address inventory, and report a zero-line inventory diff or explain every
    line of it.

## What converting annotation and api-key found

Beyond the corrections folded into the recipe above, the primitives the
recipe assumed were not all there yet, and a later pass on this plan (this
one) found more:

1. **`createApp` did not yet take the shape this plan assumed, in either
   direction.** The tree has both an older `application.ts` still built
   around `Tier` (`"live" | "memory"`) and `Infrastructure`, and a newer
   `@langwatch/infrastructure` built exactly to ADR-144's member record - the
   two have not been connected. `persistenceFor(pool)` - inferring the
   backend from whether a Prisma client happens to exist - is exactly the
   inference ADR-144 decision 2 refuses, and it is still in `application.ts`
   today.
2. **No peer seam.** `withProvided` is gone from `ApplicationBuilder` and
   nothing replaces it, so 193 call sites across 62 `.ts` files (measured
   2026-09-10, source only) name a method that no longer exists and no
   converted module's test can supply a peer without booting its whole
   dependency chain.
3. **The tRPC declaration has no `withAudit`.** The REST half fulfils a
   declared action from a resolved peer; the tRPC half has no declaration for
   one, so a module recording a curated row has nowhere to move it to. In
   api-key's case the curated row turned out to be a duplicate of the
   automatic mutation row, written under the same action, adding only an id
   the generic redaction was already masking - the fix was the redaction
   rule, not a new declaration. Check that first for any other module before
   asking for the primitive.
4. **The REST runtime still cannot resolve a credential OBJECT for a route.**
   `apiKeyRestCredential` asks whether the KEY may act organization-wide, not
   only its holder, and that fact is still bound by the process with
   `bindRestMiddleware`. Until step 4 of this plan lands,
   `apps/api/src/features/<m>/<m>-rest.mount.ts` cannot be deleted for any
   family that asks a question about its own credential.
5. **An audit action must be dotted lower kebab.** `assertAuditAction` refuses
   `management.apiKey.read`, so moving a mount-side action onto a route renames
   what the trail records. api-key's two became `management.api-key.read` and
   `management.api-key.update`. The runtime also writes a row for a refusal,
   carrying the handled code, where the mount-side middleware wrote one only
   after a 2xx - a widening a converting lane must state, not discover.
6. **`reads(...)` has no landed example.** Both converted modules need zero
   members, so nothing in the tree yet shows a module naming one, being
   refused for lacking one, or being handed one at boot. The next module to
   convert that genuinely reads a member (a mailer, a cache) is the one that
   proves this half of decision 2 rather than just its type.
7. **The generator writes into `modules/`, not `packages/runtime-composition/src/`
   or `apps/ui/src/features/`.** Both this plan and ADR-144's first draft
   named the wrong location before the generator was actually built; nothing
   downstream reads the file it produces yet, so nothing broke, but the next
   lane that wires a process root to `serverModules` should import it from
   `modules/server-modules.generated.ts`.

One shape rule the conversion surfaced: a module's App must not be the home of
its services' own seams. `ApiKeyBindingId` and `ApiKeyDiagnostics` were declared
in `api-key.app.ts` and implemented in `services/`, so app and services imported
each other and `verbatimModuleSyntax` refused the cycle. Each interface belongs
in the service file that answers it.

## Order of conversion

`annotation` and `api-key` prove the primitives that exist: annotation is the
shape every other module with no member needs copies, and api-key is the one
with a bound credential, two audit rows and a peer the REST runtime itself
depends on. Neither proves the member record in anger (finding 6 above), and
neither can finish deleting its `apps/api/src/features/<m>/` directory until
`application.ts` is rewired (finding 1, and step 8 of the recipe). The
remaining modules should not start converting in parallel until that rewiring
lands: today every one of them would stop at the same wall annotation and
api-key already found.
