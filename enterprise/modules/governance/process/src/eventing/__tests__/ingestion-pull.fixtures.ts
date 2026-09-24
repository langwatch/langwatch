import {
  buildProcessDefinition,
  buildProcessManager,
  type ProcessEventEnvelope,
} from "@langwatch/eventing";

import type {
  IngestionPullListingOutcomeChannel,
  IngestionPullMetricsSink,
  IngestionPullOutcomeChannel,
  IngestionPullRunner,
  IngestionPullScheduler,
} from "../../app/governance.members.ts";
import { IngestionPullListingService } from "../../services/ingestion-pull-listing.service.ts";
import { IngestionPullService } from "../../services/ingestion-pull.service.ts";
import {
  INGESTION_PULL_PROCESS_NAME,
  IngestionPullProcess,
  type IngestionPullProcessState,
} from "../ingestion-pull.process.ts";

export const CADENCE_MS = 15 * 60_000;

class FixedSchedule implements IngestionPullScheduler {
  nextRunAt(input: { cron: string; after: number }): number {
    return input.after + CADENCE_MS;
  }
}

class UncalledRunner implements IngestionPullRunner {
  run(): Promise<{ nextCursor: string | null; eventCount: number }> {
    return Promise.reject(new Error("uncalled"));
  }
}

class UncalledOutcome implements IngestionPullOutcomeChannel {
  completed(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
  failed(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
}

class UncalledListingOutcome implements IngestionPullListingOutcomeChannel {
  agentsListed(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
  agentsListingRefused(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
  peopleListed(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
  peopleListingRefused(): Promise<void> {
    return Promise.reject(new Error("uncalled"));
  }
}

class NoMetrics implements IngestionPullMetricsSink {
  count(): void {}
  observeDuration(): void {}
}

const uncalled = () => Promise.reject(new Error("uncalled"));

/** The process manager exactly as the pipeline mounts it, with every effect uncalled. */
export function ingestionPullDefinition() {
  const process = IngestionPullProcess.create({
    schedule: new FixedSchedule(),
    execution: IngestionPullService.create({
      runPort: new UncalledRunner(),
      outcomePort: new UncalledOutcome(),
      metrics: new NoMetrics(),
    }),
    listing: IngestionPullListingService.create({
      sources: { findById: uncalled },
      agents: { syncFromSource: uncalled },
      people: { syncFromSource: uncalled },
      outcomes: new UncalledListingOutcome(),
    }),
  });
  return buildProcessDefinition(
    buildProcessManager({
      name: INGESTION_PULL_PROCESS_NAME,
      applier: process.processManager(),
    }).config,
  );
}

const ref = {
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "project-1",
  processKey: "source-1",
};

export function configuredState(
  overrides: Partial<IngestionPullProcessState> = {},
): IngestionPullProcessState {
  return {
    sourceId: "source-1",
    enabled: true,
    cron: "*/15 * * * *",
    cursor: "cursor-1",
    currentRun: null,
    currentAgentsListing: null,
    currentPeopleListing: null,
    ...overrides,
  };
}

export function onEvent({
  state,
  eventType,
  data,
  occurredAt = 1_000,
  now = occurredAt,
}: {
  state: IngestionPullProcessState;
  eventType: string;
  data: ProcessEventEnvelope["payload"];
  occurredAt?: number;
  now?: number;
}) {
  return ingestionPullDefinition().evolve({
    previousState: state,
    ref,
    input: {
      kind: "event",
      event: {
        eventId: `${eventType}:${occurredAt}`,
        eventType,
        occurredAt,
        tenantId: "project-1",
        projectId: "project-1",
        processKey: "source-1",
        payload: data,
      },
      now,
    },
  });
}

export function onWake({
  state,
  scheduledFor,
  now = scheduledFor,
}: {
  state: IngestionPullProcessState;
  scheduledFor: number;
  now?: number;
}) {
  return ingestionPullDefinition().evolve({
    previousState: state,
    ref,
    input: { kind: "wake", scheduledFor, now },
  });
}
