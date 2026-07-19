/**
 * ADR-032 Decision 9: a per-dataset Postgres advisory lock serializes EVERY
 * chunk-mutating operation (migration, normalize, append, edit, delete) so the
 * PG-authoritative counters (`rowCount`/`sizeBytes`/`chunkCount`/`chunkOffsets`)
 * stay consistent with the S3 chunk set under concurrency (I-COUNT). Without it,
 * two concurrent appends would both read `chunkCount=N`, both write `chunk-N`,
 * and one would be silently lost with the offset index left drifting.
 *
 * Mirrors the prior art in `modelDefaults.repository.ts#lockScope`: a
 * transaction-scoped `pg_advisory_xact_lock` keyed by `hashtextextended` of a
 * namespaced string id (the lock is bigint; the hash fits the key into it). The
 * lock is held for the duration of the `$transaction`, so the chunk I/O AND the
 * `Dataset` counter update commit (or roll back) as one unit.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Max wall-clock a dataset-mutation transaction may run before Prisma aborts it
 * with P2028. Sized for worst-case bulk work inside the transaction:
 *  - s3_jsonl path: edit / delete / `recomputeDatasetCounts` do O(chunkCount)
 *    `readChunk` + `rewriteChunk` calls — each a network round-trip to object
 *    storage — under the advisory lock.
 *  - legacy postgres path: a column-type migration does O(rowCount) per-row
 *    `datasetRecord.update`s before the final `dataset.update`.
 * Prisma's DEFAULT interactive-txn timeout is 5s, which P2028s on any
 * non-trivial dataset; 120s is generous enough for a large chunk set's
 * sequential S3 round-trips (or a large row set's per-row UPDATEs) while still
 * bounding a wedged transaction. Exported so the legacy path
 * (`DatasetService.updateExistingDataset`) shares the same budget.
 */
export const DATASET_MUTATION_TXN_TIMEOUT_MS = 120_000;

/**
 * Max wall-clock to WAIT for a connection from the pool before starting the
 * transaction (separate from the run timeout above). Bumped from Prisma's 2s
 * default so a busy pool doesn't spuriously fail the mutation before it even
 * starts work.
 */
export const DATASET_MUTATION_TXN_MAX_WAIT_MS = 10_000;

/**
 * Run `fn` inside a `$transaction` holding the per-dataset advisory lock. The
 * lock is keyed by `dataset:{datasetId}` so it serializes mutations of one
 * dataset without blocking unrelated datasets. `fn` receives the transaction
 * client so its `Dataset` counter update joins the same atomic unit as the
 * chunk write it follows.
 *
 * Explicit `timeout`/`maxWait` are REQUIRED here, not optional tuning: the
 * locked body performs O(chunkCount) object-storage round-trips (read/rewrite
 * each affected chunk), so Prisma's 5s default interactive-txn timeout would
 * P2028 on multi-chunk datasets. See the constants above for the sizing
 * rationale. Widening the timeout preserves the advisory-lock serialization
 * guarantee (the lock is held for the whole transaction); it only stops Prisma
 * from killing a legitimately-long chunk rewrite.
 */
export const withDatasetLock = async <T>(
  {
    prisma,
    datasetId,
  }: {
    prisma: PrismaClient;
    datasetId: string;
  },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      // `$executeRaw` (not `$queryRaw`): pg_advisory_xact_lock returns `void`,
      // which $queryRaw can't deserialize. $executeRaw runs the statement and
      // ignores the result, acquiring the lock as a side effect.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${datasetId}`}, 0))`;
      return fn(tx);
    },
    {
      timeout: DATASET_MUTATION_TXN_TIMEOUT_MS,
      maxWait: DATASET_MUTATION_TXN_MAX_WAIT_MS,
    },
  );
