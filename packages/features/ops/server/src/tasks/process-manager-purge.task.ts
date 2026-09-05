import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type {
  ProcessManagerPurgeRepository,
  ProcessManagerPurgeTarget,
} from "../repositories/process-manager-purge.repository";

const logger = createLogger("langwatch:task:process-manager-purge");

export type ProcessManagerPurgeOptions = Readonly<{
  repository: ProcessManagerPurgeRepository;
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
  repository,
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

  const targets: ReadonlyArray<{ name: string; target: ProcessManagerPurgeTarget }> = [
    { name: "ProcessManagerOutbox (dispatched)", target: "outbox-dispatched" },
    { name: "ProcessManagerInbox (consumed)", target: "inbox-consumed" },
  ];

  const report: Array<{ name: string; eligible: number; deleted: number; capped: boolean }> = [];
  for (const { name, target } of targets) {
    const eligible = await repository.countEligible({ target, retentionDays });
    if (!apply) {
      report.push({ name, eligible, deleted: 0, capped: false });
      continue;
    }
    const { deleted, capped } = await drain({
      deleteBatch: () => repository.deleteBatch({ target, retentionDays, batchSize }),
      maxBatches,
      sleepMs,
      signal,
      name,
    });
    report.push({ name, eligible, deleted, capped });
  }

  if (apply) await repository.vacuum();
  logger.info({ mode: apply ? "apply" : "dry-run", report }, "process-manager purge finished");
  return { mode: apply ? "apply" : "dry-run", targets: report };
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

  private constructor(private readonly repository: () => ProcessManagerPurgeRepository) {
    super();
  }

  static create({
    repository,
  }: {
    repository: () => ProcessManagerPurgeRepository;
  }): ProcessManagerPurgeTask {
    return new ProcessManagerPurgeTask(repository);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await purgeProcessManagerTables({
      repository: this.repository(),
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
