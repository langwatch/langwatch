import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { SuiteRunItemCommandsService } from "../../services/suite-run-item-commands.service.ts";
import { SuiteRunScenarioFactsService } from "../../services/suite-run-scenario-facts.service.ts";
import { buildSuiteRunProcessingPipeline } from "../suite-run-processing.pipeline.ts";

const SUITE_SET = getSuiteSetId("suite-1");
const LANES = {
  started: "suite_run_processing.scenarioRunStarted",
  finished: "suite_run_processing.scenarioRunFinished",
  evaluated: "suite_run_processing.scenarioRunEvaluated",
} as const;

interface Sent {
  kind: "started" | "completed" | "regraded";
  data: Record<string, unknown>;
}

/** Suite's three peer lanes as the real pipeline registers them, over a recording sender. */
function lanes(): { sent: Sent[]; lane: (name: keyof typeof LANES) => EventSubscriberDefinition } {
  const sent: Sent[] = [];
  const record = (kind: Sent["kind"]) => async (data: object) =>
    void sent.push({ kind, data: { ...data } });
  const runItems = createApiFixture<SuiteRunItemCommandsService>({
    recordSuiteRunItemStarted: record("started"),
    completeSuiteRunItem: record("completed"),
    regradeSuiteRunItem: record("regraded"),
  });
  const pipeline = buildSuiteRunProcessingPipeline({
    suiteRunStateFoldStore: createApiFixture(),
    scenarioRunFacts: SuiteRunScenarioFactsService.create(runItems),
  });
  const registered = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void registered.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return {
    sent,
    lane: (name) => {
      const found = registered.get(LANES[name]);
      if (found === undefined) throw new Error(`no peer lane registered as ${LANES[name]}`);
      return found;
    },
  };
}

function fact({
  type,
  data,
  id = "event-1",
  occurredAt = 1_700_000_000_000,
}: {
  type: string;
  data: Record<string, unknown>;
  id?: string;
  occurredAt?: number;
}): Event {
  return {
    id,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type,
    version: "2025-01-01",
    data,
  };
}

const context = { tenantId: createTenantId("project-1"), aggregateId: "run-1" };
const identity = { scenarioRunId: "run-1", scenarioId: "scen-1", batchRunId: "batch-1" };

describe("suite's peer subscribers on scenario's run facts", () => {
  describe("when a run of a suite set starts and then finishes", () => {
    /** @scenario "Suite progress follows scenario facts" */
    it("records the item started and then completed with the run's outcome", async () => {
      const { sent, lane } = lanes();

      await lane("started").handle(
        fact({
          type: SIMULATION_RUN_EVENT_TYPES.STARTED,
          data: { ...identity, scenarioSetId: SUITE_SET },
        }),
        context,
      );
      await lane("finished").handle(
        fact({
          type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
          occurredAt: 1_700_000_005_000,
          data: {
            ...identity,
            scenarioSetId: SUITE_SET,
            status: "SUCCESS",
            durationMs: 5_000,
            results: { verdict: "success", reasoning: "met", metCriteria: [], unmetCriteria: [] },
          },
        }),
        context,
      );

      expect(lane("started").eventTypes).toEqual([SIMULATION_RUN_EVENT_TYPES.STARTED]);
      expect(sent).toEqual([
        {
          kind: "started",
          data: { tenantId: "project-1", ...identity, occurredAt: 1_700_000_000_000 },
        },
        {
          kind: "completed",
          data: expect.objectContaining({
            tenantId: "project-1",
            ...identity,
            status: "SUCCESS",
            verdict: "success",
            durationMs: 5_000,
            reasoning: "met",
            occurredAt: 1_700_000_005_000,
          }),
        },
      ]);
    });
  });

  describe("when a run of a plain scenario set starts and finishes", () => {
    /** @scenario "A run of any other set leaves suite runs alone" */
    it("records nothing", async () => {
      const { sent, lane } = lanes();
      const data = { ...identity, scenarioSetId: "my-set", status: "SUCCESS" };

      await lane("started").handle(
        fact({ type: SIMULATION_RUN_EVENT_TYPES.STARTED, data }),
        context,
      );
      await lane("finished").handle(
        fact({ type: SIMULATION_RUN_EVENT_TYPES.FINISHED, data }),
        context,
      );

      expect(sent).toEqual([]);
    });
  });

  describe("when a finished fact predates the run identity it now carries", () => {
    /** @scenario "A finished fact recorded before it carried the run's identity is skipped" */
    it("still parses, records nothing and does not throw", async () => {
      const { sent, lane } = lanes();

      await expect(
        lane("finished").handle(
          fact({
            type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
            data: { scenarioRunId: "run-1", scenarioSetId: SUITE_SET },
          }),
          context,
        ),
      ).resolves.toBeUndefined();

      expect(sent).toEqual([]);
    });
  });

  describe("when a finished run's verdict moves after the fact", () => {
    /** @scenario "A changed verdict is regraded once per fact" */
    it("regrades keyed by the fact's id, and a fact that moved nothing regrades nothing", async () => {
      const { sent, lane } = lanes();
      const moved = {
        ...identity,
        scenarioSetId: SUITE_SET,
        evaluations: [],
        previousStatus: "SUCCESS",
        previousVerdict: "success",
        status: "FAILURE",
        verdict: "failure",
      };

      await lane("evaluated").handle(
        fact({ type: SIMULATION_RUN_EVENT_TYPES.EVALUATED, id: "evt-regrade", data: moved }),
        context,
      );
      await lane("evaluated").handle(
        fact({
          type: SIMULATION_RUN_EVENT_TYPES.EVALUATED,
          id: "evt-same",
          data: { ...moved, status: "SUCCESS", verdict: "success" },
        }),
        context,
      );

      expect(sent).toEqual([
        {
          kind: "regraded",
          data: expect.objectContaining({
            previousStatus: "SUCCESS",
            status: "FAILURE",
            verdict: "failure",
            idempotencyKey: "evt-regrade",
          }),
        },
      ]);
    });
  });
});
