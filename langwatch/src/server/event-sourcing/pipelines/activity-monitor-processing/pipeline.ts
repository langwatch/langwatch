import { definePipeline } from "../../";
import type { AppendStore } from "../../projections/mapProjection.types";

import { RecordActivityEventCommand } from "./commands";
import {
  ActivityEventStorageMapProjection,
  type ClickHouseActivityEventRecord,
} from "./projections/activityEventStorage.mapProjection";
import type { ActivityMonitorProcessingEvent } from "./schemas/events";

export interface ActivityMonitorProcessingPipelineDeps {
  /**
   * AppendStore writing one row per ActivityEventReceived event into
   * the `gateway_activity_events` ClickHouse table. Construction lives
   * in `pipelineRegistry.ts` (alongside the other CH-backed AppendStores).
   */
  activityEventAppendStore: AppendStore<ClickHouseActivityEventRecord>;
}

/**
 * activity-monitor-processing pipeline.
 *
 * Aggregate semantics: one event = one aggregate (`activity_event`).
 * Unlike trace-processing, there is no fold-many-spans-into-a-trace
 * shape; each ActivityEventReceived is already a complete, terminal
 * observation. The map projection writes it to ClickHouse.
 *
 * Future slices add:
 *   - Fold projection `anomalyWindow` (per-tenant rolling totals
 *     across events — input for the anomaly reactor).
 *   - Reactor `anomalyDetection` reading active AnomalyRule rows,
 *     evaluating thresholds against fold state, persisting
 *     AnomalyAlert rows + dispatching via the shared
 *     `triggerActionDispatch` helper (PR #3351 pattern).
 *
 * See:
 *   - docs/ai-gateway/governance/activity-monitor-event-sourcing.md
 *   - specs/ai-gateway/governance/activity-monitor.feature
 *   - specs/ai-gateway/governance/anomaly-detection.feature
 */
export function createActivityMonitorProcessingPipeline(
  deps: ActivityMonitorProcessingPipelineDeps,
) {
  return definePipeline<ActivityMonitorProcessingEvent>()
    .withName("activity_monitor_processing")
    .withAggregateType("activity_event")
    .withMapProjection(
      "activityEventStorage",
      new ActivityEventStorageMapProjection({
        store: deps.activityEventAppendStore,
      }),
    )
    .withCommand("recordActivityEvent", RecordActivityEventCommand)
    .build();
}
