/**
 * Integration files must run serial (shared ClickHouse/Redis). Guard against
 * fileParallelism: false being defeated by worker count override.
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
