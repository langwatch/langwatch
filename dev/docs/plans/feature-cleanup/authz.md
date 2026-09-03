# authz — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md)
and [`overengineering.md`](../../best_practices/overengineering.md). Reference
example: [`dataset.md`](./dataset.md).

**This is the authorization engine (ADR-092, ADR-110). Nothing below proposes
changing when a permission is granted or denied.** The two findings that touch
decision behaviour — P6's fail-open default and P7's dead-path comments about
the cutover — are flagged as such and are _tightening_, not relaxing. The
dual-head cutover machinery (~4,500 lines) is explicitly on the keep list: its
retirement is a rollout decision that the code cannot prove.

## 1. What is there now

**17,525 lines across 72 non-test files** (server: 51 files / 13,531 lines;
contract: 21 files / 3,994 lines), plus 48 test files / 12,932 lines. No `web`
package — [`adrs/001-package-boundary.md`](../../../../packages/features/authz/adrs/001-package-boundary.md)
declines one deliberately, and that is correct.

**51 distinct operations, declared 2–4 times each.** `AuthzService` is 32
abstract signatures (`contract/src/authz.service.ts:78-183`) and 32 concrete
methods (`server/src/services/authz.service.ts:142-749`). `AuthzGrantsService`
is 19 and 19 (`contract/src/authz-grants.service.ts:39-93`,
`server/src/services/authz-grants.service.ts:120-346`).

```
 @langwatch/authz-contract          21 files · 3,994 lines · 220 files import it
   engine · walk · matchers · registry · roles · scope · vocabulary   the pure decision engine
   authz.service.ts          abstract AuthzService              32 signatures
   authz-grants.service.ts   abstract AuthzGrantsService        19 signatures
   authz.queries.ts          41 Zod schemas — 0 used outside the file
   authz.commands.ts         45 Zod schemas — 26 used by Eventing, 19 not
        │
 @langwatch/authz-server            51 files · 13,531 lines · 8 files import it
   transport/api-trpc/authz.api.ts   AuthzTrpcApi           1 procedure
        │                              transport/api-rest/role-binding.api.ts
   app/authz.app.ts        AuthzApp   1 method                createRoleBindingsRestApp()
        │                                4 routes ── bypasses AuthzApp ───────┐
   services/authz.service.ts        AuthzService   32 methods ←───────────────┘
        │   13 one-line delegations (:497, :683-742)
        ├── AuthzCollectorService        9 methods    461 lines
        ├── AuthzGrantSnapshotService    4 methods    136
        ├── AuthzBindingReaderService    4 methods    220
        └── AuthzScopeLineageService     1 method      72
   services/authz-grants.service.ts AuthzGrantsService  19 methods
        │   13 one-line delegations (:294-346)
        ├── AuthzBindingWriterService    4 methods    429
        └── AuthzOffboardingService      1 method      64
        │
   ports/         5 files · 126 lines   2 named `…Port`, 3 baselined violations
        │
   adapters/      8 files · 2,865 lines
        │   postgres.authz.adapter.ts        239   the build — 1 `as unknown as`
        │   eventing.authz-ledger.adapter.ts 1,750 9 verbs × 2 write paths + 11 statics
        │   eventing.authz.adapter.ts          401 6 command handlers + pipeline
        │
   repositories/  abstract: read 9(+2) · listing 8 · grant 9(+2) · binding 11 · migration 13
        ├── routed/    2 files ·   353 lines   per-organization head selection
        ├── prisma/    9 files · 2,660 lines   the legacy head
        └── eventing/  5 files · 1,884 lines   the ledger head
        │
   migrations/legacy-import.authz-grant.migration.ts  1,351 lines · 5 static-only classes
   projections/authz-grant.projection.ts   183
   stores/memory/                          122
```

**Six layers between a tRPC procedure and a row. Two of them add nothing.**

## 2. Problems

### P1 — `AuthzService` is two classes wearing one name (breaks R3)

32 methods. **13 are one-line delegations that hold no rule of their own:**

| Lines                               | Count | Delegates to                 |
| ----------------------------------- | ----- | ---------------------------- |
| `services/authz.service.ts:683-721` | 8     | `this.options.listing.find*` |
| `services/authz.service.ts:723-742` | 4     | `this.bindingReader.*`       |
| `services/authz.service.ts:497-499` | 1     | `this.scopeLineage.check`    |

```ts
// services/authz.service.ts:683
async listUserBindings(args: AuthzListUserBindingsInput): Promise<AuthzAccessBinding[]> {
  return this.options.listing.findUserBindings(args);
}
```

Two of these fire `no-same-name-delegation-ts` (`:723`, `:739`); the other
eleven escape only because the delegate's name differs.

The file is on the `service-quality` baseline at
`packages/architecture-lint/src/service-quality-baseline.json:37` for
`moduleLines: 775` against a ceiling of 500
(`packages/architecture-lint/src/service-quality.ts:9`). Sixty of the excess
lines are the delegation block.

The listing half and the deciding half share nothing: `listUserBindings` never
touches `this.engine`, `this.collector` or `this.snapshots`.

### P2 — Four contract methods have no production caller, and six files pay for all 32 (breaks R8)

| Method                                               | Non-test callers anywhere |
| ---------------------------------------------------- | ------------------------- |
| `checkDetailed` (`contract/src/authz.service.ts:80`) | **none**                  |
| `explainDecision` (`:106`)                           | **none**                  |
| `authorizePermission` (`:122`)                       | **none**                  |
| `listUserAndGroupBindings` (`:144`)                  | **none**                  |

`checkDetailed`'s own docstring says otherwise —
`server/src/services/authz.service.ts:146`:

> "for adapters that must also surface legacy context fields (the tRPC
> middleware sets `ctx.organizationRole` from it)"

No such middleware exists. `grep -rn "checkDetailed"` across `packages`,
`platform` and `apps` returns four hits: two stubs, one authz-internal test,
and the declaration. The comment is the bug (R7).

Because `AuthzService` is an abstract class, **every** test double must
implement all 32. Six files do:

- `packages/features/api-key/server/src/transport/api-rest/__tests__/support/test-authz-service.ts`
  — a 42-line file that is _nothing but_ 32 `unsupported<…>()` assignments
- `packages/features/model-provider/server/src/ports/__tests__/model-provider.service.test.ts:132-275`
  — a 144-line `class Authorization extends AuthzService` with 31
  `return this.notUsed()` bodies for 1 real method
- `apps/api/src/app/__tests__/api-key-rest-security.adapter.unit.test.ts:317-415`
  — 31 `this.unavailable()` bodies for 1 real method (`hasApiKeyPermission`)
- plus `packages/features/langy/server/src/repositories/__tests__/langy-session-key.service.unit.test.ts`,
  `packages/features/api-key/server/src/transport/api-rest/__tests__/api-key.transport.unit.test.ts`,
  `platform/app/src/server/api/__tests__/langy-session-key.integration.test.ts`

Two of those six files each want exactly **one** method.

### P3 — `authz.queries.ts` declares 41 schemas nobody parses (breaks R8)

Every one of the 41 `export const …Schema` values in
`contract/src/authz.queries.ts` is referenced **only** by the `z.infer<>` on
the line beneath it. Verified per-symbol across `packages`, `platform` and
`apps`:

```ts
// contract/src/authz.queries.ts:25
export const authzCanOutputSchema = z.boolean();
export type AuthzCanOutput = z.infer<typeof authzCanOutputSchema>;
```

Nothing calls `.parse` or `.safeParse` on any of them; no route registers one;
`AuthzTrpcApi` builds its own `scopeInputSchema`
(`server/src/transport/api-trpc/authz.api.ts:62`) and `createRoleBindingsRestApp`
builds its own eight (`server/src/transport/api-rest/role-binding.api.ts:46-99`).

The contrast is the proof this is not a house rule: in the sibling file
`contract/src/authz.commands.ts`, **26 of 45** schemas _are_ consumed — the
Eventing command handlers pass them to `AuthzEventingCommandMapper.schema`
(`server/src/adapters/eventing.authz.adapter.ts:113`). Commands earn their
schemas. Queries do not.

385 lines to state what `type AuthzCanOutput = boolean` states in one.

### P4 — `AuthzGrantsService`: 13 of 19 methods are one-line delegations (breaks R3)

`ast-grep --filter no-same-name-delegation-ts` reports **9 hits in this one
file**, `services/authz-grants.service.ts:294-330`:

```ts
async attachBindings(args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> {
  return this.options.ledger.attachBindings(args);      // :294
}
async attachResourceGrant(args) { return this.options.ledger.attachResourceGrant(args); }  // :298
… revokeResourceGrants :302 · changeBindingRole :306 · revokeBindings :310
… revokeBindingsWhere :314 · offboardMember :320 · defineRole :324 · deleteRole :328
```

Four more at `:332-346` delegate to `this.bindingWriter`. Six methods
(`attach`, `update`, `revoke`, `replace`, `offboard`, `invalidateOrganization`,
`:120-289`) hold real rules — validation, tenancy assertions, the epoch bump.

### P5 — `AuthzCompatibilityLedgerPort` has one implementation, in the same package (breaks R4)

| Port                                                                                | Implementations                                                   | Verdict                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `AuthzGrantsCommandDispatcher` (`ports/authz-grants-command-dispatcher.port.ts:25`) | 1, in `platform/app/src/runtime/app/features/authz.ts:37`         | **Keep** — cross-package inversion                             |
| `AuthzRevocationTelemetry` (`ports/authz-revocation-telemetry.port.ts:3`)           | 1, in `platform/app/src/runtime/app/features/authz.ts:69`         | **Keep** — cross-package inversion                             |
| `AuthzEpochPort` (`ports/authz-epoch.port.ts:2`)                                    | 1 real (`adapters/redis.authz-epoch.adapter.ts:17`) + a test stub | **Keep** — its `redis: null` branch is a real second behaviour |
| `AuthzCompatibilityLedgerPort` (`ports/authz-compatibility-ledger.port.ts:20`)      | 1 — `adapters/eventing.authz-ledger.adapter.ts:194`, same package | **Delete**                                                     |
| `PostgresAuthzDatabase` (`ports/postgres-authz-database.port.ts:18`)                | structural type, 0 classes                                        | see P6                                                         |

The compatibility port is a nine-method abstract class whose only reason to
exist is so `AuthzGrantsService` can hold it as a field — and holding it is
what produces the nine pass-throughs in P4. `AuthzBindingWriterService:26` holds
the same port for the same reason.

### P6 — `PostgresAuthzDatabase` is cast into and out of (breaks R4, R8)

The type declares 18 delegates whose every method returns `Promise<any>`
(`ports/postgres-authz-database.port.ts:2-12`), plus `$transaction: (...args: any[]) => Promise<any>`.
It is then cast at both ends:

```ts
// platform/app/src/runtime/app/features/authz.ts:99
database: context.database as unknown as PostgresAuthzDatabase,
```

```ts
// server/src/adapters/postgres.authz.adapter.ts:163
const database = this.options.database as unknown as InternalPostgresAuthzDatabase;
```

A type reached by `as unknown as` on the way in and `as unknown as` on the way
out checks nothing. `InternalPostgresAuthzDatabase`
(`postgres.authz.adapter.ts:52-57`) is the intersection that actually describes
what the repositories need; the public one is ceremony over it.

Three of five port files are on the `strict-port-module` baseline
(`packages/architecture-lint/src/port-module-baseline.json:17-19`):
`authz-grants-command-dispatcher.port.ts` (class lacks the `Port` suffix and the
file also exports a re-export and a const),
`authz-revocation-telemetry.port.ts` (same), and
`postgres-authz-database.port.ts` (no abstract class at all).

Related: `ports/authz-grants-command-dispatcher.port.ts:9` re-exports
`AuthzLedgerUnavailableError` from the contract, and
`repositories/authz-grant.repository.ts:48` re-exports `BindingMissingError`
and `DuplicateBindingError` from the contract. CLAUDE.md forbids re-exporting
for convenience; update the importers.

### P7 — Optional dependencies production always supplies, and one fails open (breaks R5) — **security-relevant**

`AuthzServiceOptions` (`services/authz.service.ts:93-111`) marks six fields
optional. The build at `adapters/postgres.authz.adapter.ts:195-217` passes
**all** of them:

| Field                   | Declared        | Supplied by the build                                                                                                          | Absent-case behaviour                                              |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `epoch`                 | `:99` optional  | `:205` always                                                                                                                  | snapshot cache silently off (`authz-grant-snapshot.service.ts:55`) |
| `isOnEngine`            | `:109` optional | `:206` always                                                                                                                  | **`?? true` — every organization reads as on-engine** (`:184`)     |
| `tryGetEngineCutoverAt` | `:111` optional | `:207` always                                                                                                                  | `?? null` (`:191`)                                                 |
| `cacheEnabled`          | `:101` optional | `:210` when set — and `AuthzRuntimeContext.cacheEnabled` is **required** (`platform/app/src/runtime/app/features/authz.ts:31`) | cache off                                                          |
| `demoProjectId`         | `:104` optional | `:213`, same, required at `:32`                                                                                                | demo off                                                           |
| `cacheMaxAgeMs`         | `:106` optional | never passed                                                                                                                   | genuinely optional — 30s default                                   |

All three composition sites pass `cacheEnabled` and `demoProjectId`:
`platform/app/src/server/app-layer/presets.ts:1132-1141`, `:2985-2991`, and
`platform/app/src/test-utils/appPermissionsMock.ts:87-93`.

The one that matters:

```ts
// services/authz.service.ts:183
async isOnEngine({ organizationId }: { organizationId: string }): Promise<boolean> {
  return this.options.isOnEngine?.(organizationId) ?? true;
}
```

`isOnEngine` selects which head answers a permission read, and seven production
call sites branch on it — `platform/app/src/server/api/rbac.ts:1199,1266,1384,1440,2046`,
`platform/app/src/server/rbac/role-binding-resolver.ts:330,677`,
`packages/features/share/server/src/repositories/ledger/ledger.share.repository.ts:462`.
An `AuthzService` composed without it reports every organization as migrated.
Production always supplies it, so this is unreachable today — but the default
for a rollout gate whose safe answer is "legacy" should not be "engine", and
the type should not permit the omission at all. **Making the field required
removes the question; do not merely flip the default.**

### P8 — Comments naming files that do not exist in this tree (breaks R7)

Seven distinct dead paths, each verified absent from `packages/`, `platform/`,
`apps/`, `services/`, `mcp/` and `sdks/`:

| Citation                                                      | Names                                 | Exists?                                                  |
| ------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `services/authz-grants.service.ts:266`                        | `./offboard.ts`                       | no — the code is `services/authz-offboarding.service.ts` |
| `migrations/legacy-import.authz-grant.migration.ts:7`         | `engine-gate.ts`                      | no                                                       |
| `adapters/eventing.authz-ledger.adapter.ts:805`               | `engine-gate.ts`                      | no                                                       |
| `adapters/eventing.authz-ledger.adapter.ts:894`               | `genesis-import.migration.ts`         | no                                                       |
| `repositories/prisma/prisma.authz-grant.mapper.ts:22,379`     | `cutover.migration.ts`                | no                                                       |
| `repositories/prisma/prisma.authz-grant.mapper.ts:58`         | `authz-read.grants.repository.ts`     | no                                                       |
| `repositories/routed/routed.authz-read.repository.ts:34`      | `authz/runtime.ts`'s `authzCollector` | no — ADR-001 removed it                                  |
| `repositories/eventing/eventing.authz-grant.repository.ts:89` | `prismaProcessStore.ts`               | no                                                       |

`routed.authz-read.repository.ts:40` also says "like everything else under
`./authz`" — that directory is now a package.

Separately, the contract carries **six line-number citations into a
2,239-line file** that have drifted:

| Citation                      | Claims                                          | `platform/app/src/server/api/rbac.ts` actually has               |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `contract/src/matchers.ts:79` | `rbac.ts:765` — the chain                       | `throw new TRPCError({`                                          |
| `contract/src/matchers.ts:81` | `rbac.ts:1094-1110`                             | `async function resolveProjectPermissionContext(` starts at 1094 |
| `contract/src/walk.ts:69`     | `resolveProjectPermissionContext, rbac.ts:1083` | blank line                                                       |
| `contract/src/walk.ts:101`    | `floor, rbac.ts:1058`                           | blank line                                                       |

`contract/src/engine.ts:9` points at `types.ts`, which does not exist in
`contract/src/`.

The narratives themselves are long: `adapters/eventing.authz-ledger.adapter.ts:1-39`
is a 39-line ADR-092 §13 précis; the file is 24% comment (420/1,750), the
migration 21% (286/1,351), `contract/src/walk.ts` 30% (66/217). Most of that is
load-bearing and stays (see Keep list) — the dead paths and drifted line
numbers are what rots.

### P9 — Two mapper conventions in one package (breaks R2, R8)

Eight static-only classes:

- `AuthzLedgerMapper` — `adapters/eventing.authz-ledger.adapter.ts:1508`, 11 statics
- `AuthzEventingCommandMapper` — `adapters/eventing.authz.adapter.ts:112`
- `AuthzAuditRowMapper` — `adapters/eventing.authz-audit.adapter.ts:92`
- `AuthzMigrationCommandMapper` `:593`, `AuthzMigrationOwnershipMapper` `:613`,
  `AuthzBindingCoverageMapper` `:631`, `AuthzExpectedFactsMapper` `:669`,
  `AuthzMigrationProofMapper` `:1044` — all in
  `migrations/legacy-import.authz-grant.migration.ts`

Thirteen exported free functions doing the same job:

- `repositories/prisma/prisma.authz-grant.mapper.ts:116,147,197,215,263,387,410`
- `repositories/eventing/eventing.authz-grant.mapper.ts:33`,
  `eventing.authz-live-rows.mapper.ts:23,39`
- `adapters/eventing.authz-grant.adapter.ts:40`,
  `transport/api-rest/role-binding.read-back.ts:57`

Three of the static classes are `export`ed but used only inside their own file
(`AuthzExpectedFactsMapper`, `AuthzMigrationProofMapper`,
`AuthzMigrationCommandMapper` — the last is already unexported and is the model).
`roleFactToRow` / `roleRowToFact` / `grantFactToRow` are likewise exported and
used only in-file plus their test.

### P10 — `repositories/` and `migrations/` import each other (layering)

```
repositories/prisma/prisma.authz-projection.repository.ts:40
  → import { AuthzMigrationOwnershipMapper } from "../../migrations/legacy-import.authz-grant.migration"

migrations/legacy-import.authz-grant.migration.ts:80,82,86
  → import from "../repositories/authz-migration.repository"
  → import from "../repositories/prisma/prisma.authz-grant.mapper"
```

A repository reaching up into a migration for a mapper. Not a module-level
cycle today, but a directory-level one, and the mapper it wants
(`AuthzMigrationOwnershipMapper.includes(source)`, `:614`) is 18 lines of pure
string logic that belongs in `utils/`.

### P11 — `AuthzApp` is not the facade both transports call (breaks R3's premise)

`app/authz.app.ts` is 80 lines with **one** method,
`effectivePermissionsFor` (`:60`), serving the single tRPC procedure
(`transport/api-trpc/authz.api.ts:80-84`).

The REST family does not go through it. `createRoleBindingsRestApp` reads the
services straight off the Hono context on every handler —
`transport/api-rest/role-binding.api.ts:216` (`c.get("authz")`), `:236`,
`:285`, `:314` (`c.get("grants")`). All four routes, and the read-back rule at
`:246-268`, live in the transport rather than the app.

So the layout's guarantee — "a REST handler and a tRPC procedure cannot answer
differently" — is not being bought here. It is also two shapes for one job:
`AuthzTrpcApi` is a class (`api-trpc/authz.api.ts:68`),
`createRoleBindingsRestApp` is a free factory (`api-rest/role-binding.api.ts:183`).

Same file, the wire row is declared twice:

- `type BindingWire` — `transport/api-rest/role-binding.read-back.ts:25-39`
- `const bindingSchema = z.object({…})` — `transport/api-rest/role-binding.api.ts:52-62`

Nine identical fields. CLAUDE.md: "use Zod only with `infer`."

There is also a shadow at `role-binding.api.ts:236`, where
`const grants = c.get("grants")` (an `AuthzGrantsService`) shadows the outer
`grants: () => AuthzGrantsService` destructured at `:204`. Two things named
`grants` in one function.

### P12 — Small dead weight (breaks R8)

- `server/package.json:38` declares `@langwatch/prisma-client` as a **production**
  dependency. Its only importer in the package is one test file:
  `server/src/transport/api-rest/__tests__/role-binding.read-back.unit.test.ts:6`,
  which imports `@langwatch/prisma-client/generated` — the exact thing
  ADR-001 says never crosses the boundary ("Generated Prisma types never cross
  the package boundary").
- `server/src/testing.ts` is 6 lines, of which 5 are a comment and the sixth is
  `export {}`. It is a published subpath (`server/package.json:20-23`) that
  publishes nothing.
- `adapters/postgres.authz.adapter.ts:75`:
  `export type AuthzPipeline = StaticPipelineDefinition<any, any, any>` — three
  `any`s in a type that crosses to `apps/worker`
  (`apps/worker/src/features/authz/authz-worker-feature.installer.ts:1`).

## 3. What it should look like

```
contract/src/
  authz.service.ts             ~120   split 32 signatures into two capabilities:
                                      AuthzService (19: decide · authorize · resolve)
                                      AuthzAccessListingService (9: the list* family)
                                      minus checkDetailed · explainDecision ·
                                      authorizePermission · listUserAndGroupBindings
  authz-grants.service.ts       ~96   19 signatures, unchanged
  authz.queries.ts             ~130   plain `type` declarations; keep a schema only
                                      where something parses it (today: none)
  authz.commands.ts            ~380   26 parsed schemas stay; drop the 19 unused
  authz.errors.ts              ~328   unchanged — 19 of 21 already HandledError
  engine · walk · matchers · registry · roles · scope · vocabulary   unchanged

server/src/
  app/authz.app.ts             ~260   the class BOTH transports call: the tRPC
                                      read plus the four role-binding operations
                                      and the read-back rule
  services/
    authz.service.ts           ~520   decide · authorize · resolve · explain
    authz-listing.service.ts   ~110   the 12 delegations become this class's
                                      own methods over AuthzListingRepository
    authz-grants.service.ts    ~330   the 6 methods that hold rules + the 9
                                      ledger verbs as real methods
    authz-collector.service.ts ~461   unchanged
    authz-binding-writer.service.ts  ~429  unchanged
    authz-binding-reader.service.ts  ~220  unchanged
    authz-grant-snapshot.service.ts  ~136  unchanged
    authz-scope-lineage.service.ts    ~72  unchanged
    authz-offboarding.service.ts      ~64  unchanged
  ports/
    authz-epoch.port.ts                 8
    authz-grants-command-dispatcher.port.ts  ~30   renamed → …DispatcherPort
    authz-revocation-telemetry.port.ts       ~10   renamed → …TelemetryPort
    postgres-authz-database.port.ts          ~40   the real intersection, no `any`
  utils/
    authz-grant-source.ts        ~20   was AuthzMigrationOwnershipMapper
  adapters/ repositories/ projections/ migrations/ stores/   unchanged
```

**Deleted:** `ports/authz-compatibility-ledger.port.ts`, the 13 delegations in
`authz.service.ts:497,683-742`, the 13 in `authz-grants.service.ts:294-346`,
four unused contract methods, 41 unused query schemas, 19 unused command
schemas, `server/src/testing.ts`, and roughly 90 stub-method bodies across six
test files.

**≈70 files, ≈15,600 lines. Four layers instead of six.**

### The service split

`AuthzService` stops being a listing façade. The listing methods move to a
class that owns the repository directly:

```ts
// services/authz-listing.service.ts
export class AuthzAccessListingService extends AuthzAccessListingServiceContract {
  static create(options: {
    listing: AuthzListingRepository;
    bindings: AuthzBindingRepository;
  }): AuthzAccessListingService {
    return new AuthzAccessListingService(
      options.listing,
      AuthzBindingReaderService.create(options),
    );
  }

  private constructor(
    private readonly listing: AuthzListingRepository,
    private readonly bindingReader: AuthzBindingReaderService,
  ) { super(); }

  listUserBindings(args: AuthzListUserBindingsInput): Promise<AuthzAccessBinding[]>
  listOrganizationBindings(...)   listScopeBindings(...)   listGroupBindings(...)
  listTeamMemberBindings(...)     listBindingsForSynthesis(...)
  listUserCreatedRoles(...)       listManagedBindingsForUser(...)
  listManagedBindingsForOrganization(...)   getAccessBreakdown(...)
  wouldFirstBindingDisableLegacyAccess(...)
}
```

`AuthzService` keeps `check`, `can`, `authorize`, `effectivePermissions`,
`checkByIds`, `canAnyByIds`, `canBatchByIds`, `tryResolveScope`,
`checkScopeLineage`, `getDecision`, `getProjectAnyDecision`, `hasPermission`,
`authorizeProjectPermission`, `hasApiKeyPermission`, `getApiKeyProjectDecision`,
`isOnEngine`, `tryGetEngineCutoverAt` — 17 methods, every one of which reads
the engine.

The six test doubles then stub 17 or 9, not 32.
`packages/features/api-key/.../support/test-authz-service.ts` and the
`api-key-rest-security` stub want `hasApiKeyPermission` alone.

### The ledger port

`AuthzCompatibilityLedgerPort` disappears and its nine verbs become methods on
`AuthzGrantsService`, which already holds `EventingAuthzLedgerAdapter`'s only
consumer:

```ts
export type AuthzGrantsServiceOptions = {
  repository: AuthzGrantRepository;
  ledger: EventingAuthzLedgerAdapter; // the concrete class, one implementation
  epoch: AuthzEpochPort;
  newBindingId: () => string;
  bindings: AuthzBindingRepository;
};
```

Nine `no-same-name-delegation-ts` warnings go with it. `AuthzBindingWriterService`
takes the same concrete type. Nothing outside the package sees either — the port
is documented as "never exported from the package root"
(`ports/authz-compatibility-ledger.port.ts:18`), which is the admission that it
is not a boundary.

### The composition

```ts
export type AuthzServiceOptions = {
  repository: AuthzReadRepository;
  listing: AuthzListingRepository;
  bindings: AuthzBindingRepository;
  epoch: AuthzEpochPort; // was optional
  cacheEnabled: () => boolean; // was optional
  demoProjectId: () => string | undefined; // was optional
  isOnEngine: (organizationId: string) => Promise<boolean>; // was optional — see P7
  tryGetEngineCutoverAt: (organizationId: string) => Promise<Date | null>;
  cacheMaxAgeMs?: number; // genuinely optional
};
```

`adapters/postgres.authz.adapter.ts:209-217`'s three conditional spreads become
three plain fields, and `isOnEngine`'s `?? true` at `:184` stops existing —
the compiler now refuses the composition that would have taken it.

## 4. Keep list

- **The dual-head cutover machinery** — `repositories/routed/` (2 files),
  `repositories/prisma/` (9), `repositories/eventing/` (5),
  `adapters/postgres.authz-cutover.adapter.ts`, and the imperative fallback
  paths in `adapters/eventing.authz-ledger.adapter.ts:470,957,1327`. Roughly
  4,500 lines. Whether an organization is migrated is database state that the
  code cannot read at review time; retiring the legacy head is a rollout
  decision with a rollback lever attached
  (`repositories/routed/routed.authz-read.repository.ts:1-42`), not a cleanup.
  **Nothing here should be deleted on the strength of a code audit.**
- **`RoutedAuthzReadRepository` / `RoutedAuthzListingRepository`** — three
  implementations behind `AuthzReadRepository` and three behind
  `AuthzListingRepository`. Real polymorphism, and the one-pass head pin
  (`routed.authz-read.repository.ts:71,97,181`) is a correctness mechanism, not
  indirection. The four `no-same-name-delegation-ts` hits on this file are the
  idiom the rule is meant to tolerate — `overengineering.md` exempts routed
  repositories from `layer-class` for exactly this reason.
- **`AuthzGrantsCommandDispatcher` and `AuthzRevocationTelemetry`** — one
  implementation each, both in `platform/app/src/runtime/app/features/authz.ts:37,69`.
  Genuine inversions; the feature must not reach the app.
- **`AuthzEpochPort`** — `RedisAuthzEpochAdapter.create({ redis: null })`
  (`adapters/redis.authz-epoch.adapter.ts:17`) is a second real behaviour, and
  the port is what lets the composition root not know about Redis.
- **`projections/authz-grant.projection.ts` and `adapters/eventing.authz.adapter.ts`**
  — event sourcing inside the server package is where ADR-001 puts it. The six
  command handlers (`eventing.authz.adapter.ts:126-302`) are an open set,
  one class per command.
- **`adapters/eventing.authz-ledger.adapter.ts`** — 1,750 lines and a hot
  correctness path, already at its quality ceiling. Every verb has two write
  paths because the rollout is per-organization. The only complaint is length,
  and splitting it would spread one invariant across files. It stays; only its
  three dead file-path comments (P8) change.
- **`AuthzCollectorService`, `AuthzBindingWriterService`, `AuthzGrantSnapshotService`,
  `AuthzScopeLineageService`, `AuthzOffboardingService`, `AuthzBindingReaderService`**
  — six cohesive classes, each with a small public surface over private helpers.
  This is what the services directory should look like; the 336-line average is
  `authz.service.ts` and `authz-grants.service.ts` dragging it up.
- **`stores/memory/memory.per-organization-cached-gate.store.ts`** — one
  consumer (`adapters/postgres.authz-cutover.adapter.ts:59`), but it owns a TTL
  policy with its own four tests and is the thing an operator's rollback flips.
- **The contract's engine** — `engine.ts`, `walk.ts`, `matchers.ts`,
  `registry.ts`, `roles.ts`, `scope.ts`. Pure, ordered, parity-tested. The 30%
  comment density in `walk.ts` documents the ORDER, which is the decision.
- **`authz.errors.ts`** — 19 of 21 already `HandledError` with stable codes and
  customer-safe messages. `DuplicateBindingError` and `BindingMissingError`
  (`:285,295`) are deliberately plain `Error`s carrying a `code` field, lifted
  into `DuplicateGrantError` / `GrantValidationError` by
  `authz-grants.service.ts:389-403`. R6 is satisfied; no transport re-derives a
  status from `error.name` anywhere in this feature.

## 5. Cost and order

Six commits, each leaving the suite green.

1. **Comments (P8, P12).** Delete the seven dead file paths, the four drifted
   `rbac.ts` line numbers, the false `checkDetailed` docstring, and
   `server/src/testing.ts` with its package export. Move
   `@langwatch/prisma-client` to `devDependencies`. Zero behaviour change,
   zero risk, and it stops the next reader chasing `./offboard.ts`.

2. **Dead surface (P2, P3).** Remove `checkDetailed`, `explainDecision`,
   `authorizePermission` and `listUserAndGroupBindings` from
   `contract/src/authz.service.ts` and `services/authz.service.ts`; delete the
   41 unused schemas in `authz.queries.ts` and the 19 in `authz.commands.ts`,
   replacing each with the `type` it was only ever inferring. Shrinks six test
   stubs by four methods each. Contract change — 220 files import the package,
   but none of them touch these symbols, so the diff is confined.

3. **Make dependencies required (P7).** Six optional fields become five
   required plus one genuinely optional; `isOnEngine`'s `?? true` goes.
   Touches `adapters/postgres.authz.adapter.ts:195-217` and
   `platform/app/src/runtime/app/features/authz.ts`. **Security-relevant and
   tightening only** — the composition root already passes everything, so the
   runtime is unchanged and the compiler starts refusing the shape that was not.

4. **Delete `AuthzCompatibilityLedgerPort` (P5).** Nine ledger verbs become
   real methods on `AuthzGrantsService`; `AuthzBindingWriterService` takes the
   concrete adapter. Removes nine `no-same-name-delegation-ts` warnings and one
   port file. Package-private throughout.

5. **Split the listing half out of `AuthzService` (P1, P2).** New
   `AuthzAccessListingService` + its contract capability; 12 delegations become
   its own methods. `authz.service.ts` drops under the 500-line service-quality
   ceiling and leaves the baseline. Largest blast radius of the six — every
   caller of a `list*` method moves to the second capability — so it goes last
   among the structural moves.

6. **The transports (P11).** Move the four role-binding operations and the
   read-back rule behind `AuthzApp`; make `createRoleBindingsRestApp` call it
   the way `AuthzTrpcApi` does. Derive `BindingWire` from `bindingSchema` with
   `z.infer`. Rename the shadowed `grants` at `role-binding.api.ts:236`. Fold
   `AuthzMigrationOwnershipMapper` into `utils/authz-grant-source.ts`, breaking
   the `repositories/` ↔ `migrations/` edge (P10).

Commits 1–4 are independent. 5 depends on 2. 6 is independent of all of them.

## 6. Blast radius

**`@langwatch/authz-server` — 8 non-test files import it:**

| File                                                                              | Symbols                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform/app/src/runtime/app/features/authz.ts`                                  | `AuthzPipeline`, `AuthzGrantsCommandDispatcher`, `AuthzGrantsCommandSenders`, `AuthzLedgerUnavailableError`, `AuthzRevocationTelemetry`, `deriveAuthzGrantId`, `LEDGER_APP_HANDLE_WAIT_MS`, `ObservabilityAuthzCutoverAdapter`, `PostgresAuthzAdapter`, `PostgresAuthzDatabase` |
| `platform/app/src/server/app-layer/app.ts`                                        | `AuthzApp`                                                                                                                                                                                                                                                                      |
| `apps/api/src/app-rest/app-rest.features.ts`                                      | `createRoleBindingsRestApp`                                                                                                                                                                                                                                                     |
| `apps/api/src/index.ts`                                                           | `createRoleBindingsRestApp` (re-export)                                                                                                                                                                                                                                         |
| `apps/api/src/features/authz/authz-trpc.mount.ts`                                 | `AuthzTrpcApi`, `AuthzTrpcContext`                                                                                                                                                                                                                                              |
| `apps/worker/src/features/authz/authz-worker-feature.installer.ts`                | `AuthzGrantsCommandSenders`, `AuthzPipeline`                                                                                                                                                                                                                                    |
| `packages/system-migrations/src/system-migration.ts`                              | prose reference only                                                                                                                                                                                                                                                            |
| `platform/app/src/server/app-layer/authz/__tests__/grant-provenance.unit.test.ts` | test                                                                                                                                                                                                                                                                            |

`index.ts` exports 15 symbol groups (`server/src/index.ts:1-33`); every one has
at least one external consumer. That surface is already the right size.

**`@langwatch/authz-contract` — 220 non-test files import it.** Densest
consumers: `platform/app/src/runtime/app/internal-api` (16),
`platform/app/src/runtime/app/features` (6),
`packages/features/gateway/server/src/transport/api-trpc` (6),
`packages/api/src/trpc` (5), `packages/features/organization/server/src/transport/api-trpc` (5).

This is why commits 2 and 5 are the expensive ones and everything else is
cheap: the server package has eight importers, the contract has two hundred and
twenty. Any change to `AuthzService`'s shape is a two-hundred-file question;
everything inside `server/src` is not.
