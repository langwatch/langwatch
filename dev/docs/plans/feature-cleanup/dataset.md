# dataset — cleanup review

Reference example for [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).

## 1. What is there now

**9,147 lines, 35 non-test server files, 26 actual operations**, declared ~118 times.

```
  @langwatch/dataset-contract
    dataset.service.ts            abstract DatasetService        26 signatures
        │
  server/src
    app/dataset.app.ts            DatasetApp                     26 methods  ← 22 one-line pass-throughs
        │
    services/dataset.service.ts   DatasetService                 30 methods  ← 7 pass-throughs behind a runtime throw
        │
    ports/dataset.port.ts         DatasetUploadPort   (7)
                                  DatasetContentPort  (10)       18 signatures
                                  DatasetNormalizeQueuePort (1)
        │
    adapters/dataset-content.adapter.ts   10 methods
    adapters/dataset-upload.adapter.ts     8 methods
        │
    services/dataset-mutations.ts  1,080 lines, 7 free functions, speaks Prisma
        │
    repositories/prisma/…
```

Wrapped outside by two more pure-wiring classes: `adapters/postgres.dataset.adapter.ts`
(98 lines) and `platform/app/src/runtime/app/features/dataset.ts` → `AppDatasetRuntime`
(85 lines, 3 methods, all one-line delegations).

**Seven layers between a tRPC procedure and a Prisma call. Five add no behaviour.**

## 2. Problems

### P1 — Three service-layer modules hold a `PrismaClient` (breaks R1)

- `services/dataset-mutations.ts:29` — every function takes `prisma: PrismaClient`
- `services/dataset-lock.ts:63` — `withDatasetLock({ prisma, datasetId }, fn)` calls
  `prisma.$transaction` and `tx.$executeRaw` directly
- `services/dataset-record-counts.ts:45` — `attachDatasetRecordCounts` calls
  `prisma.datasetRecord.groupBy`

The advisory lock, the transaction and the raw SQL all belong behind
`DatasetContentRepository`. Today the service layer knows Prisma's transaction API,
Postgres advisory-lock syntax, and `hashtextextended`.

### P2 — `dataset-mutations.ts` is a class written as seven functions (breaks R2)

1,080 lines, 7 exported free functions. Each takes the same three collaborators:

```ts
export const appendS3JsonlRecords = async ({ prisma, dataset, projectId, entries,
                                             forcedIds, storage, repository: providedRepository }) => {
  const repository = providedRepository ?? DatasetRepository.create(prisma);   // ← 5×, verbatim
```

`repository` is optional. `adapters/dataset-content.adapter.ts:186,230,304` passes it;
the other nine call sites do not, so half the paths build a **second repository
instance** over the same client.

Line 29 aliases the import:

```ts
import { DatasetContentRepository as DatasetRepository } from "../repositories/prisma/dataset-content.repository";
```

`DatasetRepository` is a different, real abstract class in the same package
(`repositories/dataset.repository.ts:22`). Inside this file the name means
something else than everywhere else.

### P3 — The optionality tree is dead (breaks R5)

`services/dataset.service.ts:54-62` — five optional dependencies. Seven methods:

```ts
if (!this.options.uploads) throw new Error("Dataset upload capability is not configured");
```

`adapters/postgres.dataset.adapter.ts:91` adds an eighth via `requireNormalization()`.

The only production composition is `platform/app/src/server/app-layer/presets.ts:1440`:

```ts
const datasetRuntime = AppDatasetRuntime.create({ database: prisma });
```

`AppDatasetRuntime.create` always builds a storage resolver
(`platform/app/src/runtime/app/features/dataset.ts:57-67`), so `uploads`, `content`,
`queue` and `storageResolver` are never absent and all eight guards are unreachable.

`presets.ts:3192` records what the optionality already cost:

> "Not optional in practice: `AppDatasetRuntime.create` builds its own storage resolver
> whenever one is not supplied, and that resolver refuses to exist without a
> process-owned AWS configuration. Omitting it threw … out of `createTestApp` itself —
> so a suite calling it at module scope could not even load."

### P4 — 16 of 21 errors are plain `Error` (breaks R6)

`services/errors.ts` — 403 lines, 21 classes, 5 extend `HandledError`. Compensated by:

| Where | What |
|---|---|
| `transport/api-rest/dataset.error-handler.ts:24-64` | `DOMAIN_ERROR_HTTP`, **keyed on `error.name`**, 15 entries |
| `transport/api-trpc/dataset-record.api.ts:76,86,95,104,236` | `instanceof` ladder |
| `transport/api-trpc/dataset.api.ts:101` | `error.name === name` helper |

Rename a class and REST silently degrades 404 → 500. The handler documents its own
damage at `dataset.error-handler.ts:88-93`: a handled 404 logs as a 500 incident.

### P5 — Two of five ports have one implementation (breaks R4)

| Port | Impls | Verdict |
|---|---|---|
| `DatasetStorage` | 3 — S3, Azure, local | **Keep** |
| `DatasetStorageResolver` | 1, in `platform/app` | **Keep** — cross-package inversion |
| `DatasetNormalizeQueuePort` | 1 in-package, app may swap | **Keep** |
| `DatasetContentPort` | 1, same package | **Delete** |
| `DatasetUploadPort` | 1, same package | **Delete** |

### P6 — `index.ts` publishes ~40 symbols; 2 are used outside (breaks R8)

Five `export *` lines (`index.ts:64-68`). Externally used: `UploadTooLargeError` (5 files),
`DatasetNotFoundError` (1). `stripNullBytes`, `toJsonlChunks`, `chunkedMeta`, `parseJsonl`,
`assertNoTraversal`, `appendS3JsonlRecords`, `recomputeDatasetCounts`, `UPLOAD_MAX_BYTES`,
`stagingUploadKey`, `CHUNK_MAX_BYTES` — zero external users each.

## 3. What it should look like

```
contract/src/
  dataset.service.ts          split the 26-method interface into three:
                              DatasetService (10) · DatasetRecordService (7) · DatasetUploadService (7)

server/src/
  app/dataset.app.ts                 ~190   the one class both transports call; holds the
                                            cross-service rules (upsert completion,
                                            "finalize then enqueue"); composes the services
  services/
    dataset.service.ts               ~320   upsert · naming · list · archive · mapping · copy
    dataset-record.service.ts        ~280   pages · head · upsert · batch · delete
    dataset-upload.service.ts        ~330   pending · staged · finalize · abort · retry
    dataset-chunk.service.ts         ~700   was dataset-mutations.ts, as a class
    dataset-normalization.service.ts  ~90   unchanged
  repositories/
    dataset.repository.ts                   abstract
    dataset-record.repository.ts            abstract
    dataset-content.repository.ts           abstract — owns the lock, the transaction, the raw SQL
    prisma/prisma.dataset.repository.ts
    prisma/prisma.dataset-record.repository.ts
    prisma/prisma.dataset-content.repository.ts
  ports/
    dataset-storage.port.ts          ~175   3 implementations — kept
    dataset-normalize-queue.port.ts   ~15
    dataset-migration-database.port.ts ~66
  adapters/                                 s3 · azure · local · postgres-migration
  errors/dataset.errors.ts           ~260   21 classes, every one a HandledError
  utils/
    dataset-chunking.ts              ~200   shared pure functions
    dataset-sanitize.ts               ~20
  jobs/  transport/
```

**Deleted:** `ports/dataset.port.ts`, `adapters/dataset-content.adapter.ts`,
`adapters/dataset-upload.adapter.ts`, `adapters/postgres.dataset.adapter.ts`,
`services/dataset-lock.ts`, `services/dataset-record-counts.ts`,
`services/presigned-upload.ts`, and ~115 of the 145-line error handler.

**≈24 files, ≈5,800 lines. Three layers instead of seven.**

### The chunk service — no Prisma below the repository

The lock is a database concern, so it moves behind the repository. `fn` receives a
**transactional repository**, never a `Prisma.TransactionClient`:

```ts
export abstract class DatasetContentRepository {
  /**
   * ADR-032 Decision 9. Runs `fn` under the per-dataset advisory lock, inside one
   * transaction, so a chunk write and the counter update it implies commit together.
   * `fn` gets a repository bound to that transaction.
   */
  abstract withDatasetLock<T>(
    datasetId: string,
    fn: (tx: DatasetContentRepository) => Promise<T>,
  ): Promise<T>;

  abstract findForMutation(input: { projectId: string; datasetId: string }): Promise<DatasetMutationRecord>;
  abstract updateCounts(input: { projectId: string; datasetId: string; counts: RecomputedDatasetCounts }): Promise<void>;
  abstract countRecordsByDataset(input: { projectId: string; datasetIds: string[] }): Promise<Map<string, number>>;
}
```

```ts
export class DatasetChunkService {
  private constructor(
    private readonly storage: DatasetStorage,
    private readonly datasets: DatasetContentRepository,
  ) {}

  static create(options: { storage: DatasetStorage; datasets: DatasetContentRepository }): DatasetChunkService {
    return new DatasetChunkService(options.storage, options.datasets);
  }

  async append(input: { dataset: DatasetMutationRecord; projectId: string; entries: unknown[]; forcedIds?: (string | undefined)[] }): Promise<ChunkedDatasetMeta> {
    this.assertReady(input.dataset);
    return this.datasets.withDatasetLock(input.dataset.id, async (tx) => {
      const chunks = await this.writeChunksFrom(input);
      await tx.updateCounts({ projectId: input.projectId, datasetId: input.dataset.id, counts: chunkedMeta(chunks) });
      return chunkedMeta(chunks);
    });
  }

  async editRecord(...): Promise<void>
  async deleteRecords(...): Promise<{ count: number }>
  async writeInitialChunks(...): Promise<ChunkedDatasetMeta>
  async deleteAllChunks(...): Promise<void>
  async recomputeCounts(...): Promise<RecomputedDatasetCounts>
  async migrateColumns(...): Promise<void>

  private assertReady(dataset: DatasetMutationRecord): void
  private readOffsets(dataset: DatasetMutationRecord): ChunkOffset[]
  private locateChunkFor(recordId: string, dataset: DatasetMutationRecord): Promise<number>
}
```

Two constructor fields replace 21 repeated parameters. `PrismaClient` leaves the service
layer entirely. The `providedRepository ??` line disappears five times over, and the
second-repository bug with it.

### The errors

```ts
export class UploadTooLargeError extends HandledError {
  constructor(sizeBytes: number, maxBytes: number) {
    super("dataset_upload_too_large", `The upload is ${sizeBytes} bytes; the limit is ${maxBytes}.`, {
      httpStatus: 400,
      fault: "customer",
      meta: { sizeBytes, maxBytes },
    });
  }
}
```

Both transports answer from the error itself. `DOMAIN_ERROR_HTTP` and its 15 name-string
keys go, both tRPC ladders go, and the handled-404-logs-as-500 bug goes with them.

### The composition

```ts
export class DatasetApp {
  static create(options: {
    database: PrismaClient;              // only here, at the composition seam
    storage: DatasetStorageResolver;
    queue: DatasetNormalizeQueuePort;
    experiments?: DatasetExperimentLookup;
  }): DatasetApp
}
```

Required dependencies are required, so the eight "not configured" throws stop existing.
`PostgresDatasetAdapter` and `AppDatasetRuntime` collapse into the composition root.

## 4. Keep list

- `DatasetStorage` and its three adapters — real polymorphism.
- `DatasetStorageResolver` — a genuine inversion; the feature must not reach the app.
- `app/dataset.app.ts` — required by the layout rule, and it holds real cross-service rules.
- `services/dataset-normalization.service.ts` — already the right shape.

## 5. Cost and order

Five commits, each leaving the suite green:

1. **Errors → `HandledError`** (16 classes + presentation entries). Deletes the REST map
   and both tRPC ladders. Biggest correctness win, no structural risk.
2. **`dataset-mutations.ts` → `DatasetChunkService`**, lock and transaction behind
   `DatasetContentRepository`. Fixes the double-repository bug and R1.
3. **Adapters → services**; delete `DatasetContentPort` / `DatasetUploadPort`.
4. **Make dependencies required**; collapse `PostgresDatasetAdapter` + `AppDatasetRuntime`
   into the composition root.
5. **Split the contract interface**; shrink `index.ts` to the ~10 symbols anyone imports.

## 6. Blast radius

15 files outside the feature import `@langwatch/dataset-server`. They use `DatasetApp`,
`DatasetTrpcApi`, `DatasetRecordTrpcApi`, `BatchRecordTrpcApi`, `S3DatasetStorageAdapter`,
`AzureDatasetStorage`, `DatasetS3ClientResolver`, `DatasetS3ClientLease`,
`PostgresDatasetMigrationAdapter`, `UploadTooLargeError`, `DatasetNotFoundError`.
