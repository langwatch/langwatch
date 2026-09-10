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
| `FeatureInstallOptions.rest.onError` and every family `onError` | step 3 |
| `defineModule`, `serverFeature`, `ServerFeatureBuilder.build()` | step 2 |
| `contributesWorkerWork` | step 2 |
| every `refusing<M>Feature` and `Logged<M>Absence` | as `<m>` converts |

## What is landed already (2026-09-10)

The kernel of step 2 is in `@langwatch/runtime-composition` and green:

- `src/infrastructure-needs.ts` - `MissingNeeds`, `NeedsResult`,
  `MissingInfrastructureError`, `assertInfrastructure`.
- `defineServerModule(name).needs<I>()(...members)`, the member names threaded
  through the builder chain onto `requiredInfrastructure` on the declaration.
  `defineModule` still answers under its old name until the rename wave, and
  both entry points build the same builder.
- `ApplicationBuilder.withModules(modules)`, and an `assertInfrastructure` pass
  over every declaration at the top of `boot()`, before any `create`.
- `tests/infrastructure-needs.unit.test.ts` pins the boot refusal and the
  incomplete-tuple type, bound to
  `specs/server/declarative-process-composition.feature`.

`createApp` still takes `{ name }` and `boot({ role, config })`; moving `role`,
`config` and `infrastructure` into `createApp` is step 3 and touches every
process root, so it lands with the first converted module, not before.

## What is built, in order

### Step 1 - the pool

`packages/runtime-composition/src/infrastructure.ts`

```ts
export interface Infrastructure { /* the closed member list, ADR-144 s2 */ }
export type Needs<Member extends keyof Infrastructure> = Pick<Infrastructure, Member>;
export class MissingInfrastructureError extends Error {
  constructor(readonly module: string, readonly member: string) { … }
}
export function assertInfrastructure(
  module: string,
  members: readonly string[],
  pool: Readonly<Record<string, unknown>>,
): void;   // throws MissingInfrastructureError on the first undefined member
```

`packages/runtime-composition/src/create-infrastructure.ts` holds
`createInfrastructure(config: InfrastructureConfig): Infrastructure & Disposable`
and is reachable only through the `./infrastructure` entry, so a module server
package importing `Needs` never pulls a Prisma client onto its graph.

`packages/test-harness/src/create-test-infrastructure.ts` holds
`createTestInfrastructure(overrides?: Partial<Infrastructure>): Infrastructure`,
every member an honest fake (`FakeClock`, in-memory bus, recording audit sink,
in-memory object store, the Prisma test double).

### Step 2 - `defineServerModule`

`packages/runtime-composition/src/server-module.ts`, replacing
`feature-installer.ts`'s `defineModule` chain.

```ts
type MissingNeeds<I, Members extends readonly string[]> =
  Exclude<keyof I & string, Members[number]>;

declare function defineServerModule<const Name extends ModuleName>(name: Name): {
  needs<I extends object>(): <const M extends readonly (keyof I & string)[]>(
    ...members: M
  ) => [MissingNeeds<I, M>] extends [never]
    ? ServerModuleBuilder<Name, I>
    : ["missing infrastructure members", MissingNeeds<I, M>];
} & ServerModuleBuilder<Name, EmptyInfrastructure>;
```

`ServerModuleBuilder` carries `.withRepositories`, `.withApp`,
`.withTransports`, `.withWorkers`, `.withTasks`, and every one of them returns
a `ServerModuleDeclaration` that is *already installable*. There is no
`.build()`.

`InstallableServerModule<Infrastructure>` keeps `install` as a **property with
a function type**. A type test pins that: turning it into a method deletes the
contravariance the compile-time guarantee rests on.

### Step 3 - `createApp`

`packages/runtime-composition/src/application.ts`

```ts
export function createApp<Pool extends Partial<Infrastructure>>(options: {
  role: ServerRole;                       // "api" | "worker" | "tasks"
  config: Readonly<Record<string, unknown>>;
  infrastructure: Pool;
}): ApplicationBuilder<Pool>;

class ApplicationBuilder<Pool> {
  withModules(modules: readonly InstallableServerModule<Pool>[]): this;
  boot(): Promise<BootedRuntime<Pool>>;
}
```

`role` and `config` move from `boot()` to `createApp`, so a builder cannot be
half-configured, and `boot()` takes nothing. `withModule` (singular),
`withInfrastructure`, `withPersistence` and `withProvided` go: the pool decides
persistence (`prisma` present means the postgres backend), and a module wanting
a peer names its token.

Boot order, unchanged from ADR-133 except for the first line:

1. `assertInfrastructure` per module, in declaration order.
2. providers, duplicate names, missing peers, cycle.
3. topological order, then `create` per module.
4. role contributions: `api` mounts transports, `worker` starts workers,
   `tasks` registers tasks.
5. services start, then hosts open.

### Step 4 - the REST declaration

- per-route `.withCredential(kind)` on `RouteBuilder`, defaulting to the
  family's kind, retyping `actor` and `scope` through `DOOR_SCOPE_TIER`.
- `.withAudit(action)` on `RouteBuilder`, recorded in `RouteState.audit`.
- the REST runtime declares `identity` and `api-key` as its own dependencies
  and resolves every credential kind itself; `bindRestMiddleware` for a
  credential goes.
- the runtime fulfils `audit`, `idempotency`, `rateLimit`, `cache`, `bodyLimit`
  and `no-store` from the pool.
- `FeatureInstallOptions.rest.onError` deleted; a legacy wire error shape moves
  into the contract's error schema.

### Step 5 - the generator

`dev/scripts/generate-modules.mjs`, run by `pnpm generate:modules` and by
`start:prepare:files`, reads `modules/catalogue.json`:

```jsonc
{ "id": "api-key", "root": "modules/api-key", "tier": "core",
  "server": true, "web": true }
```

and writes, checked in:

- `packages/runtime-composition/src/server-modules.generated.ts` -
  `export const serverModules = [apiKeyServer, annotationServer, …] as const;`
- `apps/ui/src/features/web-modules.generated.ts` - the same for the web half.

`tier: "enterprise"` entries are emitted only in the enterprise build
(`LANGWATCH_BUILD_TIER=enterprise`), so the OSS output has no enterprise import
at all. One test asserts a fresh run equals the checked-in file.

### Step 6 - the address inventory

`apps/api/src/app-rest/api-rest.addresses.json`, generated from the mounted
declarations: `[{ "method": "POST", "path": "/api/api-keys", "credential":
"organization" }, …]`, sorted by path then method. One snapshot test
(`apps/api/src/app-rest/__tests__/api-rest.addresses.snapshot.integration.test.ts`)
boots `createApp` with `createTestInfrastructure()` and every module, generates
the inventory and compares. A conversion that moves a route or changes a door
fails it.

## The transition

`createApp`'s REST runtime mounts on the same Hono root
`api-production.composition.ts` uses, so both paths serve at once and a module
moves between them without a wire change.

Per module, in one lane, one commit:

1. `api-production.composition.ts` loses the module's lines.
2. `apps/api/src/features/<m>/` is deleted.
3. `modules/<m>/server/src/<m>.server.ts` gains `.needs<…>()(…)`.
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
   `<M>App.create` takes, beside `repositories` and `dependencies`, because
   `keyof` that parameter and the repository factory's own signature ARE the
   module's member set now. Each old member goes to exactly one of four homes,
   in this order of preference:
   - **derived in `create`** from what the module already has (annotation's
     logger, api-key's ksuid binding-id generator and its warning log);
   - **asked of a peer** through its `<F>Api` token, where the peer owns the
     answer (api-key's binding-id derivation is `authorization.deriveGrantId`,
     because a second copy of a deterministic id derivation drifts and writes
     rows the revocation queries never find);
   - **the module's own config slice**, where the value has an environment
     binding the module already declares — give the App a `static readonly
     configSchema` and read `setup.config` (api-key's `API_KEY_PEPPER`);
   - **a named pool member**, and only then.
   A member that fits none of the four is a finding to report, not a member to
   invent.
3. Drop `.build()` from the declaration and name it with `defineServerModule`.
   Every call already answers something installable. There is no `.needs(...)`
   tuple and no `<M>Needs` type: naming a member the pool does not have is a
   compile error at the App's own `create`, which is where the member set is
   stated.
4. Move each mount-side credential binding onto its route as
   `.withCredential(kind)`; the family default stays on the router.
5. Move each mount-side audit middleware onto its routes as
   `.withAudit("<action>")`, one per audited method, and list the old actions in
   the report.
6. Move idempotency, rate limit, cache and body limit the same way.
7. The family `onError` MOVES, it does not die, wherever the family is
   published and its bodies are not the house shape. Export the renderer from
   the module's own transport file beside the declaration
   (`annotationRestErrors` beside `annotationRest`) and hand it to
   `runtime.mount`. Deleting it instead silently rewrites what a customer's
   integration parses: `/api/annotations` answers `{ status, message }` and the
   house renderer answers `{ error, message, …meta, fault }` at a different
   status vocabulary. `FeatureInstallOptions.rest.onError` therefore survives
   until the declaration can state a family's wire error shape itself; the
   "What dies" row above is premature.
8. Delete `apps/api/src/features/<m>/` and the module's lines in
   `api-production.composition.ts`, `app-trpc.features.ts` and
   `api-rest.doors.ts` (hand these lines to the coordinator, do not edit them
   in a shared lane). **This step cannot run before step 3 lands.** Until
   `createApp` mounts a module's declared transports on the same Hono root the
   process serves from, deleting the module's installer takes the family off
   the wire. Before then a lane shrinks those files only by what the module
   actually took over — an audit middleware, a bound error renderer — and
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
   (`service-does-not-open-a-channel`).
10. Point the module's tests at the SAME `createApp` production uses:
   `createApp({ role: "api", config, repositories: "memory", channels: "memory" })`,
   handing in any member the test cares about as a named argument. There is no
   `createTestInfrastructure`, no test-only builder and no pool for a fixture to
   assemble — one seam, so there is no test-only path to rot. Memory is asked
   for by name; it is never a default and never what a missing database falls
   back to.
   **Open**: a peer Api is not a pool member, so none of the named arguments
   answers `ProjectApi`. Installing the peer's module instead installs its peers
   after it (annotation names five; api-key names three; the chain reaches the
   authz ledger), which is no longer a unit test. The seam that hands one peer's
   Api in by its token has to survive whatever `withProvided` is renamed to.
11. Run `rtk pnpm --filter @langwatch/<m>-server test:unit`, regenerate the
    address inventory, and report a zero-line inventory diff or explain every
    line of it.

## What converting annotation and api-key found

Beyond the corrections folded into the recipe above, five primitives the recipe
assumes are not there yet. A lane converting one of the other 45 stops at each
of these rather than working around it.

1. **`createApp` still takes a pool.** The signature in the tree is
   `createApp({ role, config, infrastructure }).withModules(…).boot()`. The
   rulings' `repositories: "postgres" | "memory"`, `channels: "live" | "memory"`
   and the flattened member arguments are not built, and `persistenceFor(pool)`
   — inferring the backend from whether a Prisma client happens to exist — is
   exactly the inference ruling 12 refuses.
2. **No peer seam.** `withProvided` is gone from `ApplicationBuilder` and
   nothing replaces it, so 464 call sites across the tree name a method that no
   longer exists and no converted module's test can supply a peer.
3. **The tRPC declaration has no `withAudit`.** The REST half fulfils a declared
   action from the pool; the tRPC half has no declaration for one, so a module
   recording a curated row has nowhere to move it to. In api-key's case the
   curated row turned out to be a duplicate of the automatic mutation row,
   written under the same action, adding only an id the generic redaction was
   masking — the fix was the redaction rule, not a new declaration. Check that
   first for any other module before asking for the primitive.
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
   after a 2xx — a widening a converting lane must state, not discover.

One shape rule the conversion surfaced: a module's App must not be the home of
its services' own seams. `ApiKeyBindingId` and `ApiKeyDiagnostics` were declared
in `api-key.app.ts` and implemented in `services/`, so app and services imported
each other and `verbatimModuleSyntax` refused the cycle. Each interface belongs
in the service file that answers it.

## Order of conversion

`annotation` and `api-key` prove the primitives: annotation is the shape every
other module copies, and api-key is the one with a bound credential, two audit
rows and a peer the REST runtime itself depends on. After those two, the
remaining modules convert in any order, in parallel, because they share no
file.
