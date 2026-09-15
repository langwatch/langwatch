/**
 * A one-shot program run by name through the task launcher: a migration, a
 * backfill, a provisioning step, a document generator. A task calls services
 * and adapters — never a repository directly — and throws the contract's
 * errors, same as any other feature entrypoint.
 *
 * A concrete task exposes `static create(deps)` and is composed at the boot
 * of whichever process runs it (today only `apps/tasks`).
 */
export abstract class Task {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Runs the task to completion or throws. `signal` aborts on SIGINT/SIGTERM
   * — a task doing chunked work should check it between chunks so a shutdown
   * lands cleanly rather than being killed mid-write.
   */
  abstract run(input: { args: readonly string[]; signal: AbortSignal }): Promise<void>;
}
