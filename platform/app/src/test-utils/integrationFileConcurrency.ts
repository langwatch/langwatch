/**
 * Whether the integration suite runs its files concurrently, and the two
 * mechanisms that keep the answer from drifting.
 *
 * Concurrency is a correctness question for this suite rather than a speed
 * knob. Its fixtures share one ClickHouse database and one Redis instance:
 * BullMQ keys a queue by name alone, so two files building the same pipeline
 * consume each other's jobs, and the suites that replay goose migrations
 * rebuild shared rollup tables in place, so a file reading such a table while
 * another replays sees it mid-swap: a column that briefly does not exist, or
 * an aggregate that reads as zero until the migration's reconciliation lands.
 *
 * Vitest implements `fileParallelism: false` by clamping the worker count to
 * one and nothing else, and it applies `VITEST_MAX_WORKERS` *after* that clamp.
 * An exported worker count therefore restores concurrent files while the config
 * still reads `fileParallelism: false` and the reporter still prints one run,
 * which is a silent way to lose the property above. So the override is
 * withdrawn at config load, and a worker slot above the first fails loudly if
 * one ever appears regardless.
 */

/** Whether the suite was explicitly asked to run its files concurrently. */
export function integrationFilesRunInParallel(env: NodeJS.ProcessEnv): boolean {
  return env.VITEST_INTEGRATION_PARALLEL === "1";
}

/**
 * Withdraw a worker-count override that would defeat serial files. Called from
 * the integration vitest config, which runs before vitest resolves its options.
 */
export function withdrawWorkerCountOverride(env: NodeJS.ProcessEnv): void {
  if (integrationFilesRunInParallel(env)) return;
  delete env.VITEST_MAX_WORKERS;
}

/**
 * Fail the run when this process holds a worker slot above the first while
 * files are meant to be serial. Vitest numbers slots 1 to maxWorkers and
 * recycles them, so a slot above one means more than one worker exists.
 */
export function assertSerialWorkerSlot(env: NodeJS.ProcessEnv): void {
  if (integrationFilesRunInParallel(env)) return;
  const slot = Number(env.VITEST_POOL_ID ?? "1");
  if (!Number.isFinite(slot) || slot <= 1) return;
  throw new Error(
    `Integration files must run one at a time, but vitest started worker slot ${slot}. ` +
      "Something raised the worker count above one: VITEST_MAX_WORKERS is applied after " +
      "vitest's fileParallelism clamp, so exporting it re-enables concurrent files. Unset " +
      "it, or set VITEST_INTEGRATION_PARALLEL=1 to ask for concurrency deliberately.",
  );
}
