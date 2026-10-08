import {
  defineAggregate,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import {
  UPGRADE_ALERTS_INITIAL_STATE,
  UPGRADE_ALERTS_INTERVAL_MS,
  UPGRADE_ALERTS_PROCESS_NAME,
  runUpgradeAlertsCheck,
  upgradeAlertsCheckSchema,
  upgradeAlertsStateSchema,
  upgradeAlertsWake,
} from "./ops-upgrade-alerts.process.ts";

export const UPGRADE_ALERTS_PIPELINE_NAME = "ops_upgrade_alerts";

interface UpgradeAlertsApp {
  checkUpgradeAlerts(input: { since: number; until: number }): Promise<unknown>;
}

/** The upgrade alert check, once an hour across the fleet: a scheduled process with no events. */
export function buildUpgradeAlerts({
  app,
  processStore,
}: EventingSetup<unknown, UpgradeAlertsApp>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: UPGRADE_ALERTS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(UPGRADE_ALERTS_PROCESS_NAME, (pm) =>
      pm
        .state(upgradeAlertsStateSchema, UPGRADE_ALERTS_INITIAL_STATE)
        .schedule({ everyMs: UPGRADE_ALERTS_INTERVAL_MS })
        .onWake(upgradeAlertsWake)
        .intent(
          "check",
          upgradeAlertsCheckSchema,
          runUpgradeAlertsCheck({
            check: (window) => app.checkUpgradeAlerts(window),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One check at a time; mail and Slack each time out well inside five minutes.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}
