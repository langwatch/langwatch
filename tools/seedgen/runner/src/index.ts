import type { BootedApplication } from "@langwatch/process";
import type { Task } from "@langwatch/task";

import { SeedApplyTask } from "./seed-apply.task.ts";
import { seedApiTokens } from "./seed-kinds.ts";

/** The `LANGWATCH_TASK_MODULES` entry: haven and CI name this package; no image does. */
export function createTasks(app: BootedApplication): Task[] {
  const apis = {
    authz: app.service(seedApiTokens.authz),
    dataRetention: app.service(seedApiTokens.dataRetention),
    trace: app.service(seedApiTokens.trace),
    log: app.service(seedApiTokens.log),
    metric: app.service(seedApiTokens.metric),
    user: app.service(seedApiTokens.user),
    organization: app.service(seedApiTokens.organization),
    project: app.service(seedApiTokens.project),
    licensing: app.service(seedApiTokens.licensing),
  };
  return [new SeedApplyTask({ apis, input: process.stdin, output: process.stdout })];
}
