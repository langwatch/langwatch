/**
 * This test process's one upgrade of the live test database, run in apps/tasks with only the
 * test stores' URLs. Spec: specs/upgrade/live-test-fixtures.feature.
 */
import { createLiveUpgrade, spawnLiveUpgrade } from "@langwatch/test-harness/live-upgrade";
import { TASKS_APP_DIRECTORY } from "@langwatch/upgrade/gate";

export const upgradedLiveDatabase = createLiveUpgrade({
  run: spawnLiveUpgrade({ tasksDirectory: TASKS_APP_DIRECTORY }),
  path: process.env.PATH,
});
