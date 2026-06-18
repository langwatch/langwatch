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
 * Run `fn` inside a `$transaction` holding the per-dataset advisory lock. The
 * lock is keyed by `dataset:{datasetId}` so it serializes mutations of one
 * dataset without blocking unrelated datasets. `fn` receives the transaction
 * client so its `Dataset` counter update joins the same atomic unit as the
 * chunk write it follows.
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
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dataset:${datasetId}`}, 0))`;
    return fn(tx);
  });
