/**
 * The startup convergence of the in-place system migrations (ARCHITECTURE.md §7): the runner is
 * ops', each subject answers its own migrations through its Api, so this boots the tasks
 * container and runs ops' declared pass. No migration lock: the pass leases per tenant.
 */
import type { TaskInput } from "./config.ts";
import { runModuleTask } from "./module-task.ts";

/** Ops' task, declared through `.withTasks` over its booted app. */
const SYSTEM_MIGRATIONS_PASS_TASK = "system-migrations-pass";

export async function systemMigrationsPass(input: TaskInput): Promise<void> {
  await runModuleTask({ name: SYSTEM_MIGRATIONS_PASS_TASK, args: [], signal: input.signal });
}
