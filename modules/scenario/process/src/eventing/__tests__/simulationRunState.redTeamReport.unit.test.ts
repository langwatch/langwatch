/**
 * A red team run's held or broke report folded into the run's metadata.
 *
 * @see modules/scenario/specs/red-team-scenario.feature
 */

import { createTenantId } from "@langwatch/eventing";
import type { FoldProjectionStore } from "@langwatch/eventing";
import {
  RED_TEAM_REPORT_METADATA_KEY,
  type RedTeamRunReport,
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEvent,
  type SimulationRunQueuedEvent,
  type SimulationRunRedTeamReportRecordedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulation-run-state.projection.ts";

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const foldProjection = SimulationRunStateFoldProjection.create({ store: noopStore });

const TENANT_ID = createTenantId("tenant-1");
const RUN_ID = "scenario-run-1";

const report: RedTeamRunReport = {
  outcome: "broke",
  brokeAtTurn: 3,
  strategy: "crescendo",
  owaspIds: ["LLM07"],
  attackGoal: "Make the agent reveal its system prompt",
  maxTurns: 12,
  turnsUsed: 4,
  turnScores: [
    { turn: 1, score: 2 },
    { turn: 3, score: 9, hint: "quoted the prompt" },
  ],
};

const base = { aggregateId: RUN_ID, aggregateType: "simulation_run" as const, tenantId: TENANT_ID };

const queued: SimulationRunQueuedEvent = {
  ...base,
  id: "event-queued",
  createdAt: 500,
  occurredAt: 500,
  type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
  version: SIMULATION_EVENT_VERSIONS.QUEUED,
  data: {
    scenarioRunId: RUN_ID,
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioSetId: "set-1",
    metadata: { langwatch: { targetReferenceId: "agent_1" } },
  },
};

const finished: SimulationRunFinishedEvent = {
  ...base,
  id: "event-finished",
  createdAt: 3000,
  occurredAt: 3000,
  type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
  version: SIMULATION_EVENT_VERSIONS.FINISHED,
  data: {
    scenarioRunId: RUN_ID,
    status: "FAILURE",
    results: { verdict: "failure", reasoning: "Leaked", metCriteria: [], unmetCriteria: ["x"] },
  },
};

const recorded: SimulationRunRedTeamReportRecordedEvent = {
  ...base,
  id: "event-red-team",
  createdAt: 3100,
  occurredAt: 3100,
  type: SIMULATION_RUN_EVENT_TYPES.RED_TEAM_REPORT_RECORDED,
  version: SIMULATION_EVENT_VERSIONS.RED_TEAM_REPORT_RECORDED,
  data: { scenarioRunId: RUN_ID, report },
};

function fold(events: SimulationProcessingEvent[]): SimulationRunStateData {
  let state = foldProjection.init();
  for (const event of events) state = foldProjection.apply(state, event);
  return state;
}

describe("simulationRunStateFoldProjection red team report", () => {
  /** @scenario "The red team report is recorded on the stored run" */
  it("writes the report under redTeam and keeps the status and other metadata", () => {
    const before = fold([queued, finished]);
    const after = foldProjection.apply(before, recorded);

    expect(after.Status).toBe(before.Status);
    expect(JSON.parse(after.Metadata ?? "null")).toEqual({
      langwatch: { targetReferenceId: "agent_1" },
      [RED_TEAM_REPORT_METADATA_KEY]: report,
    });
  });

  it("folds the same report twice to identical metadata", () => {
    const once = foldProjection.apply(fold([queued, finished]), recorded);
    expect(foldProjection.apply(once, recorded).Metadata).toBe(once.Metadata);
  });

  it("writes the report alone when the run carries no metadata", () => {
    expect(
      JSON.parse(SimulationRunStateFoldProjection.withRedTeamReport({ metadata: null, report })),
    ).toEqual({ redTeam: report });
  });
});
