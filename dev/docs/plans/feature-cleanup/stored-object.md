# stored-object — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md);
shape follows [`dataset.md`](./dataset.md).

## 1. What is there now

**3,814 lines, 36 non-test source files** (22 server, 14 contract), plus 8 test
files / 1,032 lines — 4,854 lines in the package.

The feature is **half-wired**. `adrs/001-package-boundary.md:5` is still
`**Status:** Proposed`, and the code matches: the Postgres-backed lifecycle
service, the public RPC family and the ClickHouse import migration are all
built and none of them is reached by a production door. What production
actually runs is the *legacy* implementation, 17 more files and **3,882 lines**
still in `platform/app/src/server/stored-objects/`, baselined as
`legacy-implementation` at
`packages/architecture-lint/src/legacy-feature-fragment-baseline.json:622-638`.

There is no single stack; there are four, and only three of them are live.

```
LIVE — byte delivery and the existence probe
  apps/api/src/app-rest/app-rest.features.ts:369
  apps/api/src/features/stored-object/stored-object-trpc.mount.ts:17
      │   createFilesRestApp   441 lines, a FUNCTION (transport/api-rest/stored-object.api.ts:167)
      │   StoredObjectTrpcApi   89 lines, 1 procedure
      ▼
    app/stored-object.app.ts       StoredObjectApp    7 methods ← 7 of 7 are one-line delegations
      │                                                           4 of them delegate to a method
      │                                                           the injected object does not have
      ├─ storedObjects ─┐
      ├─ files ─────────┤ both keys get ONE object (platform/app/src/server/app-layer/app.ts:535-537)
      │                 └─ platform/app/src/server/stored-objects/stored-objects.service.ts:102
      │                     StoredObjectsService  5 public methods  →  ClickHouse
      └─ owners
           └─ adapters/stored-object-owner-lookup.runtime.ts   22 lines, 1 field, deref'd immediately
                └─ services/stored-object-owner-lookup.service.ts     63 lines
                     └─ ports/stored-object-owner.repository.ts       14 lines, 1 impl, same package
                          └─ repositories/clickhouse/…owner.repository.ts   67 lines
                               └─ ports/…owner-instance-directory.port.ts   → app adapter

LIVE — storage dispatch (app + worker)
    adapters/stored-object-storage.runtime.ts    55   StoredObjectStorageRuntime
      ├─ adapters/stored-object-storage.registry.ts  77  (public constructor, no `static create`)
      │    └─ StoredObjectStorageDriver × 3 — s3 / azure-blob / file, supplied by the roots
      └─ adapters/stored-object-destination.policy.ts 52  StoredObjectDestinationPolicy

LIVE — the user-avatar vertical, and nothing else
    platform/app/src/runtime/app/features/user-avatar-stored-object-service.composition.ts:46
      └─ services/stored-object.service.ts   634 lines, 12 public + 11 private methods
           ├─ stores/stored-object.store.ts (56) → adapters/postgres.stored-object.adapter.ts (12)
           │    → stores/postgres/postgres.stored-object.store.ts (191) → Prisma
           ├─ StoredObjectStoragePort   → app avatar adapter
           ├─ StoredObjectDeliveryPort  → a stub that throws  (composition.ts:22-26)
           └─ StoredObjectUploadTokenPort → a stub that throws (composition.ts:28-36)

DEAD — nothing constructs or mounts either of these
    api/public/stored-object.api.ts          122   StoredObjectsPublicApi, 4 RPC routes
    migrations/clickhouse-import.…migration.ts 244 + 4 ports (ports/stored-object.port.ts:78-119)
```

The four public operations (`createUpload`, `confirmUpload`, `get`, `delete`)
are declared **five times**: `contract/src/stored-object.service.ts:59-101`,
`services/stored-object.service.ts:150-366`, `app/stored-object.app.ts:93-112`,
`contract/src/stored-object.commands.ts:66-96`, and
`api/public/stored-object.api.ts:51-119`. Three of the five are unreachable.

## 2. Problems

### P1 — `StoredObjectApp`'s dependency type is unsatisfiable, and production proves it (breaks R8, R7)

`app/stored-object.app.ts:76-83` declares two keys:

```ts
storedObjects: StoredObjectService;      // getById → ReadStoredObjectResult
files: StoredObjectFileReadPort;         // getById → StoredObjectFileRead | null
```

Both interfaces require a method named `getById`, with return types that are
not assignable in either direction (`{ metadata, bytes }` vs
`{ row, stream } | { row, status } | null`). **No single object can satisfy
both keys.** The docblock at `app/stored-object.app.ts:64-66` asserts the
opposite:

> "The process's own stored-object service satisfies both, which is why one
> object can be passed for both keys"

and `platform/app/src/server/app-layer/app.ts:531-537` acts on that claim:

```ts
this.storedObjectApp = StoredObjectApp.create({
  storedObjects: deps.storedObjects,
  files: deps.storedObjects,      // the same object
  owners: deps.storedObjectOwners,
});
```

`deps.storedObjects` is `StoredObjectsService`
(`platform/app/src/server/app-layer/dependencies.ts:318`, class at
`platform/app/src/server/stored-objects/stored-objects.service.ts:102`), which
has exactly five public methods: `storeFromBytes`, `headById`, `getById`,
`getStorageUsageByProject`, `deleteOwnedBy`. It has **no** `createUpload`,
`confirmUpload`, `resolveDelivery` or `delete`. So four of `StoredObjectApp`'s
seven methods — `stored-object.app.ts:93`, `:100`, `:105`, `:110` — call a
method that is `undefined` at runtime. They survive only because nothing mounts
the door that calls them (P2).

The feature's own test concedes the point: `__tests__/stored-object.api.unit.test.ts:14`
supplies `{} as StoredObjectServiceContract`. The type is satisfiable only by a cast.

### P2 — 366 lines of the feature are built and mounted nowhere (breaks R8)

`grep -rn` across `apps/`, `packages/`, `platform/`, `services/` finds **zero**
non-test references outside the package to:

| Symbol | Lines | Declared |
|---|---|---|
| `StoredObjectsPublicApi` | 122 | `api/public/stored-object.api.ts:29` |
| `ClickHouseImportStoredObjectMigration` | 244 | `migrations/clickhouse-import.stored-object.migration.ts:42` |
| `StoredObjectProjectSourcePort` | | `ports/stored-object.port.ts:92` |
| `StoredObjectLegacySourcePort` | | `ports/stored-object.port.ts:98` |
| `StoredObjectLegacyLocationPort` | | `ports/stored-object.port.ts:106` |
| `StoredObjectLegacyWriterDrainPort` | | `ports/stored-object.port.ts:113` |
| `storedObjectsPublicRpc` | | `contract/src/stored-object.commands.ts:99` |
| `storedObjectsInternalRpc` | | `contract/src/stored-object.queries.ts:60` |

The migration cannot run: the registry is
`platform/app/src/server/app-layer/system-migrations/runtime.ts:108-114`
(`registeredMigrations`), and `stored-objects-clickhouse-import-v0` is not in
it. The four legacy ports have no implementation outside
`__tests__/clickhouse-import.stored-object.migration.unit.test.ts:11-52`.

**Of the 49 symbols `server/src/index.ts` exports, 24 have no external
importer.** The full list is in §6.

### P3 — `createFilesRestApp` is a 275-line function that should be a class (breaks R2, and the layout rule)

`transport/api-rest/stored-object.api.ts:167-441` takes five collaborators
(`security`, `app`, `dualAuth`, `requireProjectPermission`, `rateLimit`,
lines 174-186), destructures them at line 187, and closes three functions over
them: `authorizeFileRead` (`:207`), `authorizeFilePurpose` (`:247`) and
`handleFileRead` (`:299`, 124 lines). That is R2's "a class whose constructor
was never written", verbatim.

It also breaks the layout grammar twice over. `packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md:118`:

> Files ending in `.service.ts`, `.store.ts`, `.projection.ts`, `.api.ts`, and
> `.migration.ts` export the correspondingly named class.

and `:134-137`:

> API options are static configuration, not callbacks that resolve services…
> API source may not … await a resolver before awaiting the operation.

`app: () => StoredObjectApp` is exactly that callback (`:181`), and it is
awaited-through twice: `await app().resolveOwner({ id })` (`:363`) and
`await app().readById(…)` (`:391`).

### P4 — Seven server files fail the strict layout grammar this branch exists to enforce (breaks the layout rule)

`packages/features/stored-object/feature.json` declares `"layoutVersion": 0`
and `packages/features/catalogue.json` lists the feature as governed. Checking
every non-test server path against `SERVER_PATTERNS`
(`packages/architecture-lint/src/feature-layout.ts:65-91`):

| Path | Why it fails |
|---|---|
| `server/src/storage.ts` | second package-root barrel; only `index.ts` and `testing.ts` are allowed |
| `server/src/api/public/stored-object.api.ts` | the pattern is `transport/<surface>/`, not `api/<surface>/` |
| `server/src/ports/stored-object-owner.repository.ts` | a `.repository.ts` under `ports/` |
| `server/src/adapters/stored-object-destination.policy.ts` | `.policy` is not a canonical artifact |
| `server/src/adapters/stored-object-owner-lookup.runtime.ts` | `.runtime` is not a canonical artifact |
| `server/src/adapters/stored-object-storage.registry.ts` | `.registry` is not a canonical artifact |
| `server/src/adapters/stored-object-storage.runtime.ts` | `.runtime` is not a canonical artifact |

`StoredObjectStorageRegistry` additionally has a **public constructor and no
`static create`** (`adapters/stored-object-storage.registry.ts:27`), against
ADR-002:118 ("Concrete runtime classes expose `static create`"), and
`StoredObjectStorageRuntime.forProject` reaches for `new` at
`adapters/stored-object-storage.runtime.ts:43`.

*(Confirm by running the architecture lint; the grammar match above was done by
hand against the regexes.)*

### P5 — Two ports have one same-package implementation; two more are satisfied by throwing stubs (breaks R4, R5)

| Port | Real implementations | Verdict |
|---|---|---|
| `StoredObjectStorageDriver` (`adapters/…registry.ts:9`) | 3+ — app s3/azure/file, worker s3/file | **Keep** |
| `StoredObjectAzureDestinationPort` (`…policy.ts:11`) | 2 — `project-storage-destination.ts:32`, `worker-stored-object-storage.adapter.ts:43` | **Keep** |
| `StoredObjectStoragePort` (`ports/stored-object.port.ts:28`) | 1, in `platform/app` | **Keep** — cross-package inversion |
| `StoredObjectOwnerInstanceDirectoryPort` (`…port.ts:17`) | 1, in `platform/app` | **Keep** |
| `StoredObjectOwnerLookupTelemetryPort` (`…port.ts:9`) | 1, in `platform/app` | **Keep** |
| `StoredObjectProjectS3ConfigPort` (`…policy.ts:15`) | 2, app + worker | **Keep** |
| `StoredObjectStore` (`stores/stored-object.store.ts:36`) | 2, both in-package (`postgres/…store.ts:25`, `testing.ts:8`) | **Keep** — `testing.ts` is a published entry point |
| `StoredObjectOwnerRepository` (`ports/stored-object-owner.repository.ts:12`) | 1, same package (`repositories/clickhouse/…:16`) | **Delete** |
| `StoredObjectProjectDestinationResolverPort` (`…runtime.ts:20`) | 1, same package (`…policy.ts:20`) | **Delete** |
| `StoredObjectDeliveryPort` (`ports/stored-object.port.ts:69`) | 0 — a stub that throws | see below |
| `StoredObjectUploadTokenPort` (`ports/stored-object.port.ts:64`) | 0 — a stub that throws | see below |

`StoredObjectServiceOptions` (`services/stored-object.service.ts:45-56`) makes
`delivery` and `uploadTokens` **required**, and the only production composition
satisfies them with objects whose every method throws:

```ts
// platform/app/src/runtime/app/features/user-avatar-stored-object-service.composition.ts:22-36
class AppUnavailableStoredObjectDeliveryPort extends StoredObjectDeliveryPort {
  async mint(): Promise<never> {
    throw new Error("Stored Object delivery is not composed for the avatar vertical");
  }
}
```

This is R5's failure mode inverted: rather than an optional field guarded by a
runtime throw, it is a required field whose only supplier *is* the throw. The
constructor promises a capability the process cannot provide, and
`resolveDelivery`/`createUpload`/`confirmUpload` on the avatar service are
unreachable-except-to-crash.

The classic R5 shape is present too. `StoredObjectStorageSelection.azure` is
optional (`adapters/stored-object-destination.policy.ts:8`) and guarded:

```ts
// adapters/stored-object-destination.policy.ts:39-43
if (this.selection.backend === "azure") {
  const azure = this.selection.azure?.resolve();
  if (!azure) throw new Error("Azure storage destination is missing its validated configuration");
```

Both composition roots already make the branch unreachable — they set `azure`
exactly when `backend === "azure"`
(`platform/app/src/server/stored-objects/project-storage-destination.ts:52-56`;
`apps/worker/src/platform/infrastructure/worker-stored-object-storage.adapter.ts:82-86`)
— and the worker even re-asserts the same invariant itself at
`worker-stored-object-storage.adapter.ts:65-68`. Three statements of one rule
the type could carry once as a discriminated union.

### P6 — `StoredObjectOwnerLookupRuntime` is a wrapper both callers unwrap on the same line (breaks R3)

`adapters/stored-object-owner-lookup.runtime.ts:8-21` is a 22-line class with
one readonly field and no methods. Both production call sites dereference it
immediately:

```ts
// platform/app/src/server/app-layer/presets.ts:2897-2900 and :3667-3670
storedObjectOwners: StoredObjectOwnerLookupRuntime.create({
  instanceDirectory: AppStoredObjectOwnerInstanceDirectory.create(),
  telemetry: AppStoredObjectOwnerLookupTracingAdapter.create(),
}).resolver,
```

`StoredObjectOwnerLookupService.create({ repository, telemetry })` is the whole
of it, and the only thing the wrapper adds is constructing
`ClickHouseStoredObjectOwnerRepository` — one line, which belongs at the
composition root along with the two adapters already there.

`adapters/postgres.stored-object.adapter.ts` is the same shape at 12 lines:
`static create(database) { return PostgresStoredObjectStore.create(database); }`.
Its only reason to exist is that `PostgresStoredObjectStore` is not exported
from `index.ts` — the export list is the thing to fix, not the wrapper.

### P7 — All 14 error codes reach the customer as a bare slug (breaks R6)

`contract/src/stored-object.errors.ts` is otherwise exemplary: 14 codes, a
shared `StoredObjectHandledError` base (`:70-85`), an HTTP status table
(`:53-68`), explicit `fault` on every 5xx (`:94`, `:164`, `:226`, `:251`). The
errors ARE `HandledError`s. What is missing is the second half of R6:

**None of the 14 codes is in `APP_ERROR_CODES` or the presentation registry.**
All 14 sit in the frozen debt list at
`platform/app/src/features/errors/logic/__tests__/codes.unit.test.ts:260-315`
(`direct_upload_unavailable`, `idempotency_conflict`, `storage_unavailable`,
`stored_object_deleted`, `stored_object_integrity_conflict`,
`stored_object_missing`, `stored_object_not_found`, `stored_object_unavailable`,
`upload_checksum_mismatch`, `upload_expired`, `upload_failed`,
`upload_incomplete`, `upload_token_invalid`, `upload_too_large`).

That is **14 of the 62 codes in the entire backlog** — the single largest block
any one feature owns. The list's own docblock (`:246-258`) calls them "debt, not
exemptions — each is a real code a customer can reach today as a bare slug."

One genuine plain-`Error` outlier:
`contract/src/stored-object-owner-resolver.ts:10`,
`StoredObjectOwnerLookupUnavailableError`, which the REST route then has to
recognise by `instanceof` to answer 502
(`transport/api-rest/stored-object.api.ts:365`). A degraded ClickHouse fan-out
is arguably infrastructure and may stay plain — but then the route's `instanceof`
is the R6 tell, and it should be a `HandledError` with `fault: "platform"` so
the boundary answers from the error rather than the router.

### P8 — 41% of the REST transport is comment, much of it history (breaks R7)

`transport/api-rest/stored-object.api.ts` is **183 comment lines out of 441**.
The package overall is 10%; this one file is four times that.

- `:43-50` — a rollout note: "Tuneable per project when AC12 lands proper per-tenant overrides."
- `:78-92` — 15 lines on a superseded design: "This used to compare the denial's message word for word, which made a copy edit a silent behaviour change…"
- `:340-357` — 18 lines of review narrative, including "(Sergio review 2026-05-20)" and "Retained so URLs embedded in historical message content keep resolving — no backfill (see #4947)."
- `:269-298` — a 30-line route docblock restating the response codes the handler's own `return` statements state.
- `app/stored-object.app.ts:1-16` — 16 lines narrating the pre-refactor state ("each declared its own bag", "the mismatch had been carried by an annotation that said otherwise"), and `:57-67` contains the claim P1 disproves.
- `contract/src/safe-media-types.ts:1-13` — 29 comment lines in a 39-line file, opening by naming the file itself and then naming two other modules by role ("the content-extractor", "the files-route"), one of which has since moved.

All of the above is ADR material — `adrs/001-package-boundary.md` already exists
and already carries the delivery/owner-resolution narrative.

### P9 — the spec enforces nothing (no rule; this is why P1 and P2 went unnoticed)

`specs/stored-objects.feature:2` carries a **file-level `@unimplemented`**.
`check-feature-parity.ts:770` merges feature tags into every scenario and
`:1329` counts a scenario as bound only when it has a binding tag *and* lacks
`@unimplemented` — so all 10 `@integration` scenarios, including "A public
client creates a direct upload" (`:53`) and "The system migration copies legacy
ClickHouse rows directly" (`:123`), enforce nothing.

### P10 — smaller R8 duplication

- Two barrels over the same three adapter files, differing by one symbol:
  `server/src/index.ts:29-39` and `server/src/storage.ts:1-18`. `storage.ts`
  exports `StoredObjectByteStore`; `index.ts` does not.
- `cleanupBatchSize ?? 100` at `services/stored-object.service.ts:391`, `:436`,
  `:469`; `pageSize ?? 250` at
  `migrations/clickhouse-import.stored-object.migration.ts:91` and `:102`.
- Two representations of one fact: a URI string (`contract/src/storage-uri.ts:9`,
  `mintStoredObjectUri`) used by the live legacy path, and a structured address
  (`ports/stored-object.port.ts:12`, `{ provider, destinationId, relativeId }`)
  used by the canonical path. `StoredObjectLegacyLocationPort.parse`
  (`ports/stored-object.port.ts:106`) is the bridge, and it lives in the dead
  migration.
- `contract/src/index.ts` is 12 `export *` lines.

## 3. What it should look like

The single decision that governs everything else: **does the Postgres-backed
service ship, or does it not?** The review below assumes it does, because
`adrs/001-package-boundary.md` is written and the code is built. If the answer
is no, §5 commit 1 becomes "delete the unwired half" and the package drops to
~1,900 lines.

```
contract/src/
  stored-object.service.ts        ~102   unchanged
  stored-object.errors.ts         ~266   unchanged — plus 14 presentation.ts entries
  stored-object.commands.ts        ~85   drop the unused `storedObjectsPublicRpc` alias
  stored-object.queries.ts           —   DELETE (storedObjectsInternalRpc has no consumer)
  stored-object-owner-resolver.ts  ~20   the error becomes a HandledError
  ids · audiences · metadata · references · uploads · storage-uri · safe-media-types
  index.ts                         ~25   named exports, not 12 × `export *`

server/src/
  index.ts                         ~35   the 25 symbols with an importer
  testing.ts                       ~67   unchanged
  app/stored-object.app.ts        ~110   ONE dependency shape, satisfiable
  services/
    stored-object.service.ts      ~634   unchanged — inside its quality ceiling
    stored-object-owner-lookup.service.ts  ~70  absorbs the ClickHouse repository
  stores/
    stored-object.store.ts         ~56
    postgres/postgres.stored-object.store.ts  ~191   exported directly
  adapters/
    s3.stored-object-storage.adapter.ts     ~80   was stored-object-storage.registry.ts
    project.stored-object-storage.adapter.ts ~55  was stored-object-storage.runtime.ts
    destination.stored-object.adapter.ts     ~50  was stored-object-destination.policy.ts
  ports/stored-object.port.ts     ~80   4 legacy migration ports removed
  ports/stored-object-owner-instance-directory.port.ts   ~19
  ports/stored-object-owner-lookup-telemetry.port.ts     ~14
  transport/
    api-rest/stored-object.api.ts  ~230   a CLASS; the 183 comment lines become ~40
    api-trpc/stored-object.api.ts   ~60
  migrations/clickhouse-import.stored-object.migration.ts  ~244  registered, or deleted
```

**Deleted:** `server/src/storage.ts`, `server/src/api/public/stored-object.api.ts`,
`server/src/adapters/postgres.stored-object.adapter.ts`,
`server/src/adapters/stored-object-owner-lookup.runtime.ts`,
`server/src/ports/stored-object-owner.repository.ts`,
`server/src/repositories/clickhouse/clickhouse.stored-object-owner.repository.ts`
(folded into its service),
`contract/src/stored-object.queries.ts`.

**≈29 files, ≈3,100 lines**, and every file matching the layout grammar.

### The app's dependency shape (fixes P1)

The two `getById`s are two different operations. Name them apart and the
interface becomes satisfiable by the object production actually has:

```ts
/** What the byte-delivery surface reads: a row, and the bytes when they exist. */
export interface StoredObjectFileReadPort {
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead>;
  readFile(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectFileRead | null>;
}

export interface StoredObjectAppDependencies {
  /** The byte surface and the probe. Always composed. */
  files: StoredObjectFileReadPort;
  /** Which project owns an object, when the URL does not say. */
  owners: StoredObjectOwnerResolver;
  /**
   * The portable upload/delivery/deletion capability. Absent until a process
   * composes the Postgres service — `platform/app` composes only `files`
   * today, and the four operations below are what that costs.
   */
  storedObjects?: StoredObjectService;
}
```

`createUpload` / `confirmUpload` / `resolveDelivery` / `delete` then either
disappear from `StoredObjectApp` until a door needs them, or keep their
`storedObjects` guard **and say so** — which is the one case R5 permits,
because the composition genuinely does not supply it. Either way the type stops
asserting a capability the process does not have, and the docblock at
`stored-object.app.ts:64-66` stops being false.

### The REST family as a class (fixes P3)

```ts
export class StoredObjectRestApi {
  static create(options: {
    security: AppRestSecurity;
    app: StoredObjectApp;                    // the object, not a thunk
    dualAuth: MiddlewareHandler;
    permissions: FilesProjectPermissionCheck;
    rateLimit: FilesRateLimiter;
  }): StoredObjectRestApi;

  install<E extends Env & { Variables: FilesDualAuthVariables }>(): SecuredApp<E>;

  private async read(c: Context<E>, method: "GET" | "HEAD"): Promise<Response>;
  private async authorizeProject(input: { apiKeyProjectId?: string; userId?: string; ownerProjectId: string }): Promise<void>;
  private async authorizePurpose(input: { userId?: string; ownerProjectId: string; purpose: string }): Promise<void>;
  private async resolveOwner(input: { id: string; projectIdFromUrl?: string }): Promise<{ projectId: string } | null>;
  private respond(input: { row: StoredObjectFileRow; stream: Readable; method: "GET" | "HEAD"; filename?: string }): Response;
}
```

Five constructor fields replace five closed-over parameters and the `app()`
thunk. The comment justifying the thunk (`:176-179` — "mounting a family must
not force its services to be constructed") describes a real constraint, but the
answer to it is the composition root passing a lazily-built `StoredObjectApp`,
not every handler in the file calling `app()` twice per request.

### The storage adapters (fixes P4, P5)

```ts
export type StoredObjectStorageSelection =
  | { backend: "azure"; azure: StoredObjectAzureDestinationPort; localFilesystemRoot: string }
  | { backend: "s3" | "file"; globalS3Bucket?: string; localFilesystemRoot: string };
```

The union deletes the throw at `stored-object-destination.policy.ts:41-43` and
the worker's duplicate assertion at
`worker-stored-object-storage.adapter.ts:65-68`. `StoredObjectStorageRegistry`
gains `static create` and loses its public constructor; the three files take
`.adapter.ts` names so the layout grammar accepts them.

## 4. Keep list

- **`StoredObjectStorageDriver` and its five implementations** (app s3 / azure-blob /
  local-filesystem, worker s3 / local-filesystem). Real polymorphism, genuinely
  open — a new provider arrives without touching the others. Do not collapse it,
  and do not merge it with `StoredObjectStoragePort`: the two speak different
  currencies on purpose (URI string vs structured address), and the port is a
  cross-package inversion.
- **`StoredObjectAzureDestinationPort`** — two real implementations, one per process.
- **`StoredObjectStoragePort`, `StoredObjectOwnerInstanceDirectoryPort`,
  `StoredObjectOwnerLookupTelemetryPort`** — one implementation each, all in
  `platform/app`. Genuine inversions; the feature must not reach the app.
- **`StoredObjectStore` and `testing.ts`'s in-memory implementation** — two
  implementations, and `testing.ts` is a published subpath that
  `platform/app/src/runtime/app/features/__tests__/user-avatar-read.compatibility.adapter.unit.test.ts:10`
  imports. Keep both.
- **`services/stored-object.service.ts`** — 634 lines with a 12/24/24 profile
  already recorded in `packages/architecture-lint/src/service-quality-baseline.json:92-99`.
  It holds one lifecycle, its methods are short, its private helpers are
  private, and it takes a store rather than a client. R1 is satisfied
  throughout the package. Do not split it; the only complaint is length.
- **`app/stored-object.app.ts` as a facade** — R3 allows exactly one, and the
  layout rule requires it (`feature-layout.ts:69-72`). Seven of seven methods
  being one-line delegations is fine *for this file*; the problem is P1, not the
  delegation.
- **`contract/src/stored-object.errors.ts`** — the right shape already. It needs
  presentation entries, not restructuring.
- **The 17 legacy files in `platform/app/src/server/stored-objects/`** — out of
  scope, and correctly baselined. They are the production implementation.

## 5. Cost and order

Six commits, each leaving the suite green.

1. **Presentation copy for the 14 codes.** Add them to
   `platform/app/src/features/errors/logic/codes.ts` (sorted) and write
   `presentation.ts` entries; remove the 14 from `UNCOPIED_CODES_BACKLOG`.
   Largest customer-visible win, zero structural risk, touches no feature source.
2. **Delete what nothing reaches** (P2). `api/public/stored-object.api.ts`,
   `contract/src/stored-object.queries.ts`, `storedObjectsPublicRpc`, and — if
   the ClickHouse cut-over is not imminent — the migration and its four legacy
   ports. Shrink `index.ts` to the 25 imported symbols and delete `storage.ts`
   after repointing `@langwatch/stored-object-server/storage` at `index.ts`.
   −366 lines minimum, −610 with the migration.
3. **Fix the app's dependency shape** (P1). Rename `files.getById` → `readFile`,
   make `storedObjects` honest about the composition. Touches
   `app/stored-object.app.ts`, `platform/app/src/server/app-layer/app.ts:535`,
   and the two package tests. This is the correctness commit.
4. **`createFilesRestApp` → `StoredObjectRestApi`** (P3), and cut the comment
   block to ~40 lines, moving the rollout and review narrative into
   `adrs/001-package-boundary.md` (P8). One caller to update:
   `apps/api/src/app-rest/app-rest.features.ts:369`.
5. **Layout and ports** (P4, P5, P6). Rename the four adapter files, give
   `StoredObjectStorageRegistry` a `static create`, make
   `StoredObjectStorageSelection` a discriminated union, fold
   `StoredObjectOwnerRepository` + `ClickHouseStoredObjectOwnerRepository` into
   `StoredObjectOwnerLookupService`, delete `StoredObjectOwnerLookupRuntime` and
   `PostgresStoredObjectAdapter` and move their one line each into
   `presets.ts:2897`/`:3667` and
   `user-avatar-stored-object-service.composition.ts:46`.
6. **Bind the spec** (P9). Drop the file-level `@unimplemented`, mark the
   genuinely unbuilt scenarios individually, and add `@scenario` annotations to
   the six existing test files.

## 6. Blast radius

**11 files outside the package import `@langwatch/stored-object-server`; 22
import `@langwatch/stored-object-contract`.**

From the server package (25 symbols with an importer):

| Consumer | Symbols |
|---|---|
| `apps/api/src/app-rest/app-rest.features.ts`, `apps/api/src/index.ts` | `createFilesRestApp`, `StoredObjectApp`, `isPermissionDenial`, `requiredPermissionForPurpose`, `FilesDualAuthVariables`, `FilesProjectPermissionCheck`, `FilesRateLimiter` |
| `apps/api/src/features/stored-object/stored-object-trpc.mount.ts` | `StoredObjectTrpcApi`, `StoredObjectTrpcContext` |
| `apps/worker/src/platform/infrastructure/worker-stored-object-storage.adapter.ts`, `worker-foundation.adapter.ts` | `StoredObjectStorageRuntime`, `StoredObjectDestinationPolicy`, `StoredObjectAzureDestinationPort`, `StoredObjectProjectS3ConfigPort`, `StoredObjectStorageSelection`, `StoredObjectStorageDriver` |
| `platform/app/src/server/app-layer/presets.ts`, `app.ts` | `StoredObjectOwnerLookupRuntime`, `StoredObjectApp` |
| `platform/app/src/runtime/app/features/*` (5 files) | `PostgresStoredObjectAdapter`, `StoredObjectService`, `StoredObjectStoragePort`, `StoredObjectDeliveryPort`, `StoredObjectUploadTokenPort`, `StoredObjectStorageAddress`, `StoredObjectOwnerInstanceDirectoryPort`, `StoredObjectOwnerLookupTelemetryPort`, `StoredObjectOwnerLookupSpan` |
| `platform/app/src/server/stored-objects/storage-registry.ts` | `StoredObjectStorageRegistry`, `StoredObjectStorageDriver`, `StoredObjectStorageDriverFactory` — a pure re-export shim, which the repo's own rule forbids |
| `platform/app/src/runtime/app/features/__tests__/…` | `InMemoryStoredObjectStore` (via `/testing`) |

**With no external importer (24 of 49):** `ClickHouseImportStoredObjectMigration`,
`ClickHouseImportStoredObjectMigrationOptions`,
`STORED_OBJECTS_CLICKHOUSE_IMPORT_MIGRATION_NAME`, `StoredObjectsPublicApi`,
`StoredObjectsPublicApiOptions`, `StoredObjectsPublicApp`,
`STORED_OBJECTS_PUBLIC_API_VERSION`, `StoredObjectProjectSourcePort`,
`StoredObjectLegacySourcePort`, `StoredObjectLegacyLocationPort`,
`StoredObjectLegacyWriterDrainPort`, `LegacyStoredObjectRow`,
`StoredObjectProjectDestinationResolverPort`, `StoredObjectAppDependencies`,
`StoredObjectFileRead`, `StoredObjectFileReadPort`, `StoredObjectFileRow`,
`StoredObjectHead`, `StoredObjectServiceOptions`, `StoredObjectUploadTokenClaims`,
`StoredObjectStorageProject`, `StoredObjectStorageRuntimeOptions`,
`StoredObjectOwnerClickHouseClient`, `StoredObjectOwnerClickHouseInstance`.

From the contract package: `mintStoredObjectUri` (4),
`getStoredObjectStorageScheme` (4), `mintFileStoredObjectUri` (5),
`mintS3StoredObjectUri` (2), `mintAzureBlobStoredObjectUri` (3),
`redactStoredObjectStorageUri` (3), `redactStoredObjectStorageErrorText` (1),
`isReadbackSafe` (2, `packages/api/src/rest/media-response.ts`),
`StoredObjectStorageDestination` (3, incl. `packages/group-queue/src/storage.ts`),
`StoredObjectService` (3), `StoredObjectOwnerResolver` (2),
`StoredObjectNotFoundError` / `StoredObjectBytesMissingError` (1 each),
`StoredObjectId` (2), `StoredObjectProjectId` (1).

Commits 1, 2 and 6 touch no external consumer. Commit 3 touches
`platform/app/src/server/app-layer/app.ts`. Commit 4 touches one line in
`apps/api`. Commit 5 touches `apps/worker` (2 files), `platform/app` (3 files)
and deletes the `storage-registry.ts` shim's reason to exist.

## Verdict

**In need of work — but not the usual kind.** R1 is clean throughout, the
service is well shaped, and the errors are already `HandledError`s. The problems
are that the package declares a capability production cannot supply (P1), ships
366 lines nothing can reach (P2), writes its largest transport as a function
(P3), fails its own layout grammar in seven files (P4), and leaves 14 error
codes without customer copy (P7) while the spec that would have caught any of
it is parked behind a file-level `@unimplemented` (P9).
