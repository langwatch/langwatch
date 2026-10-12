import { fileURLToPath } from "node:url";

import type { UpgradeOutcomeCode } from "../runner/upgrade-outcome.ts";

/** The image's tasks app: the Prisma config and the LangWatchQL program the upgrade runs. */
export const TASKS_APP_DIRECTORY = fileURLToPath(
  new URL("../../../../apps/tasks/", import.meta.url),
);

/** One upgrade run as the worker's gate sees it: the runner's outcome and its last lines. */
export type UpgradeRunResult = Readonly<{ code: UpgradeOutcomeCode; logTail: readonly string[] }>;

/** Runs one upgrade in this process (Alex, 2026-10-11, slice 2). */
export type FirstInstallUpgrade = () => Promise<UpgradeRunResult>;
