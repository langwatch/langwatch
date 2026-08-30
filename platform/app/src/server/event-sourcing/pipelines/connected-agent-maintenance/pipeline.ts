import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  CONNECTED_AGENT_ARCHIVE_INTERVAL_MS,
  CONNECTED_AGENT_ARCHIVE_PROCESS_NAME,
  type ConnectedAgentArchiveDeps,
  type ConnectedAgentArchiveState,
  connectedAgentArchiveSchema,
  connectedAgentArchiveWake,
  runConnectedAgentArchive,
} from "./process-manager/connectedAgentArchive.process";

export interface ConnectedAgentMaintenancePipelineDeps {
  archiveSweep: ConnectedAgentArchiveDeps;
}

/**
 * The daily sweep of connected agents (ADR-128, "Presence"), in its own
 * pipeline for the same reason the other maintenance pipelines are in
 * theirs: archiving rows no process connects to any more is neither a run
 * concern nor a queue concern.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createConnectedAgentMaintenancePipeline(
  deps: ConnectedAgentMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("connected_agent_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(CONNECTED_AGENT_ARCHIVE_PROCESS_NAME, (pm) =>
        pm
          .state<ConnectedAgentArchiveState>({ lastSweepAt: null })
          .schedule({ everyMs: CONNECTED_AGENT_ARCHIVE_INTERVAL_MS })
          .onWake(connectedAgentArchiveWake)
          .intent(
            "archive",
            connectedAgentArchiveSchema,
            runConnectedAgentArchive(deps.archiveSweep),
          )
          // One bounded UPDATE over the (projectId, lastSeenAt) index.
          .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
