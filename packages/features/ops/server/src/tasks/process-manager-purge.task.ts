import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:process-manager-purge");

/**
 * Exactly the raw operations this task performs, PICKED from the real client
 * rather than re-declared, so a typed `PrismaClient` satisfies it with no cast.
 * Narrow on purpose: these predicates are cross-tenant by design.
 */
export type ProcessManagerPurgeDatabase = Pick<
  PrismaClient,
  "$queryRaw" | "$executeRaw" | "$executeRawUnsafe"
>;

export type ProcessManagerPurgeOptions = Readonly<{
  database: ProcessManagerPurgeDatabase;
  retentionDays?: number;
  batchSize?: number;
  /** Pause between batches so a purge never monopolises the write path. */
  sleepMs?: number;
  maxBatches?: number;
  apply?: boolean;
  signal?: AbortSignal;
}>;

export type ProcessManagerPurgeReport = Readonly<{
  mode: "dry-run" | "apply";
  targets: ReadonlyArray<{ name: string; eligible: number; deleted: number; capped: boolean }>;
}>;

/**
 * Catches the ProcessManager inbox and outbox up after a backlog, in `ctid`
 * batches that need no index (main's `ops/purge-process-manager-tables.mjs`).
 * Dry-run by default; pending and dead outbox rows are never touched.
 */
export async function purgeProcessManagerTables({
  database,
  retentionDays = 7,
  batchSize = 10_000,
  sleepMs = 200,
  maxBatches = 10_000,
  apply = false,
  signal,
}: ProcessManagerPurgeOptions): Promise<ProcessManagerPurgeReport> {
  requireWholeNumber({ name: "retentionDays", value: retentionDays, min: 1 });
  requireWholeNumber({ name: "batchSize", value: batchSize, min: 1 });
  requireWholeNumber({ name: "sleepMs", value: sleepMs, min: 0 });
  requireWholeNumber({ name: "maxBatches", value: maxBatches, min: 1 });

  const targets = [
    {
      name: "ProcessManagerOutbox (dispatched)",
      // Every value is bound, never interpolated. The window is one retention
      // period wider than the sweep's, so this only removes rows the sweep
      // would also remove.
      count: () =>
        database.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
          -- @tenancy: cross-tenant process-manager retention; ops-gated
          SELECT count(*)::bigint AS n FROM "ProcessManagerOutbox"
          WHERE "status" = 'dispatched'
            AND "dispatchedAt" < now() - (${retentionDays}::int * interval '1 day')
        `),
      deleteBatch: () =>
        database.$executeRaw(Prisma.sql`
          -- @tenancy: cross-tenant process-manager retention; ops-gated
          WITH batch AS (
            SELECT ctid FROM "ProcessManagerOutbox"
            WHERE "status" = 'dispatched'
              AND "dispatchedAt" < now() - (${retentionDays}::int * interval '1 day')
            LIMIT ${batchSize}
          )
          DELETE FROM "ProcessManagerOutbox" o USING batch WHERE o.ctid = batch.ctid
        `),
    },
    {
      name: "ProcessManagerInbox (consumed)",
      count: () =>
        database.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
          -- @tenancy: cross-tenant process-manager retention; ops-gated
          SELECT count(*)::bigint AS n FROM "ProcessManagerInbox"
          WHERE "consumedAt" < now() - (${retentionDays}::int * interval '1 day')
        `),
      deleteBatch: () =>
        database.$executeRaw(Prisma.sql`
          -- @tenancy: cross-tenant process-manager retention; ops-gated
          WITH batch AS (
            SELECT ctid FROM "ProcessManagerInbox"
            WHERE "consumedAt" < now() - (${retentionDays}::int * interval '1 day')
            LIMIT ${batchSize}
          )
          DELETE FROM "ProcessManagerInbox" i USING batch WHERE i.ctid = batch.ctid
        `),
    },
  ] as const;

  const report: Array<{ name: string; eligible: number; deleted: number; capped: boolean }> = [];
  for (const target of targets) {
    const rows = await target.count();
    const eligible = Number(rows[0]?.n ?? 0);
    if (!apply) {
      report.push({ name: target.name, eligible, deleted: 0, capped: false });
      continue;
    }
    const { deleted, capped } = await drain({
      deleteBatch: target.deleteBatch,
      maxBatches,
      sleepMs,
      signal,
      name: target.name,
    });
    report.push({ name: target.name, eligible, deleted, capped });
  }

  if (apply) await vacuum({ database });
  logger.info({ mode: apply ? "apply" : "dry-run", report }, "process-manager purge finished");
  return { mode: apply ? "apply" : "dry-run", targets: report };
}

/**
 * A plain VACUUM marks the pages reusable; VACUUM FULL would reclaim the space
 * under an ACCESS EXCLUSIVE lock the automations pipeline cannot afford. Never
 * fatal — the rows are already gone.
 */
async function vacuum({ database }: { database: ProcessManagerPurgeDatabase }): Promise<void> {
  for (const table of ["ProcessManagerOutbox", "ProcessManagerInbox"]) {
    try {
      await database.$executeRawUnsafe(
        `-- @tenancy: cross-tenant process-manager housekeeping; ops-gated\nVACUUM (ANALYZE) "${table}"`,
      );
    } catch (error) {
      logger.warn({ error, table }, "the post-purge vacuum failed; the rows are still deleted");
    }
  }
}

/**
 * Deletes one target in batches until it runs dry, the batch ceiling hits or
 * shutdown arrives. A throw carries the count with it: letting it escape bare
 * makes a partial run read as "nothing happened", which it never means.
 */
async function drain({
  deleteBatch,
  maxBatches,
  sleepMs,
  signal,
  name,
}: {
  deleteBatch: () => Promise<number>;
  maxBatches: number;
  sleepMs: number;
  signal: AbortSignal | undefined;
  name: string;
}): Promise<{ deleted: number; capped: boolean }> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    if (signal?.aborted) return { deleted, capped: false };
    let removed: number;
    try {
      removed = await deleteBatch();
    } catch (error) {
      logger.error({ error, name, deleted }, "the purge failed part way through");
      throw error;
    }
    deleted += removed;
    if (removed === 0) return { deleted, capped: false };
    await sleep({ ms: sleepMs, signal });
  }
  logger.warn(
    { name, maxBatches, deleted },
    "stopped at the batch ceiling; rows may still be eligible, so re-run to continue",
  );
  return { deleted, capped: true };
}

/**
 * Fails closed: these go into the retention predicate and the batch bounds,
 * where a zero window is every dispatched and consumed row in both tables and
 * a zero batch size deletes nothing while reporting success.
 */
function requireWholeNumber({
  name,
  value,
  min,
}: {
  name: string;
  value: number;
  min: number;
}): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be a whole number of at least ${min}; nothing was deleted`);
  }
}

function sleep({ ms, signal }: { ms: number; signal: AbortSignal | undefined }): Promise<void> {
  if (ms === 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * process-manager-purge -- --apply --retention-days=7`.
 */
export class ProcessManagerPurgeTask extends Task {
  readonly name = "process-manager-purge";
  readonly description =
    "Clears the ProcessManager inbox and outbox backlog in batches. Dry-run unless --apply is passed.";

  private constructor(private readonly database: () => ProcessManagerPurgeDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => ProcessManagerPurgeDatabase;
  }): ProcessManagerPurgeTask {
    return new ProcessManagerPurgeTask(database);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await purgeProcessManagerTables({
      database: this.database(),
      apply: args.includes("--apply"),
      signal,
      ...numberArg({ args, flag: "--retention-days", key: "retentionDays" }),
      ...numberArg({ args, flag: "--batch-size", key: "batchSize" }),
      ...numberArg({ args, flag: "--sleep-ms", key: "sleepMs" }),
      ...numberArg({ args, flag: "--max-batches", key: "maxBatches" }),
    });
  }
}

function numberArg<Key extends string>({
  args,
  flag,
  key,
}: {
  args: readonly string[];
  flag: string;
  key: Key;
}): Partial<Record<Key, number>> {
  const raw = args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
  if (raw === undefined || raw.trim() === "") return {};
  return { [key]: Number(raw) } as Record<Key, number>;
}
