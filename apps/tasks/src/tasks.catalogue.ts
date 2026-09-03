import { WebhookSignatureVectorsTask } from "@langwatch/egress";
import type { Task } from "@langwatch/task";
import { PrismaMigrateTask } from "./tasks/prisma-migrate.task";

/**
 * The one list this process's tasks live in: a feature's task is here or it
 * does not exist as far as `apps/tasks` is concerned. Most tasks take no
 * constructor arguments; the ones composed over infrastructure take the
 * process's `TasksHost` and reach for what they need through
 * `require<Handle>()`.
 *
 * Only a subset of the tasks named in
 * `dev/docs/plans/tasks-launch-interface-and-saas.md` are registered here so
 * far — see that plan and the migration's own report for what remains to
 * move in from apps/api and apps/worker.
 */
export function buildTasksCatalogue(): readonly Task[] {
  return [PrismaMigrateTask.create(), WebhookSignatureVectorsTask.create()];
}
