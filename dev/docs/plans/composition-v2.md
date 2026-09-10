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
2. Rewrite `<M>Infrastructure` as `Needs<"…" | "…">` over pool member names;
   anything not a pool member is derived inside `<M>App.create` from `secrets`,
   `clock` or `logger`.
3. Add `.needs<<M>Infrastructure>()("…", "…")` to the module declaration, the
   tuple exhaustive over the interface.
4. Move each mount-side credential binding onto its route as
   `.withCredential(kind)`; the family default stays on the router.
5. Move each mount-side audit middleware onto its routes as
   `.withAudit("<action>")`, one per audited method, and list the old actions in
   the report.
6. Move idempotency, rate limit, cache and body limit the same way.
7. Delete the family `onError`; if the wire error shape is not the house shape,
   pin it in `modules/<m>/contract/src/<m>.errors.ts`.
8. Delete `apps/api/src/features/<m>/` and the module's lines in
   `api-production.composition.ts`, `app-trpc.features.ts` and
   `api-rest.doors.ts` (hand these lines to the coordinator, do not edit them
   in a shared lane).
9. Point the module's tests at `createApiFixture`, which now boots `createApp`
   with `createTestInfrastructure()`.
10. Run `rtk pnpm --filter @langwatch/<m>-server test:unit`, regenerate the
    address inventory, and report a zero-line inventory diff or explain every
    line of it.

## Order of conversion

`annotation` and `api-key` prove the primitives: annotation is the shape every
other module copies, and api-key is the one with a bound credential, two audit
rows and a peer the REST runtime itself depends on. After those two, the
remaining modules convert in any order, in parallel, because they share no
file.
