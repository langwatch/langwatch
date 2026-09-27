import { createApiFixture } from "@langwatch/api-fixture";
import type {
  QueueSimulationRunInput,
  ResolvedScenarioRunParametersForScenario,
  ScenarioApi,
} from "@langwatch/scenario-contract";
import type { StartSuiteRunCommandData } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { SuiteExecutionService } from "../suite-execution.service.ts";

type Resolve = ScenarioApi["resolveRunParametersForScenarios"];

const resolveGold: Resolve = async () => [
  {
    scenarioId: "scenario_1",
    parameters: { tier: "gold" },
    secretParameters: {},
    scenarioVersion: 3,
  },
];

/** Every scenario resolves with no values. */
function resolveNone(ids: string[]): Resolve {
  return async () =>
    ids.map((scenarioId): ResolvedScenarioRunParametersForScenario => ({
      scenarioId,
      parameters: {},
      secretParameters: {},
      scenarioVersion: 1,
    }));
}

/** The suite's start command and the scenario owner, both recording what they were handed. */
function harness(
  options: {
    resolve?: Resolve;
    /** Refuses the queueing of these scenario run positions (0-based, in dispatch order). */
    refuseAt?: number[];
  } = {},
) {
  const started: StartSuiteRunCommandData[] = [];
  const queued: QueueSimulationRunInput[] = [];
  let dispatched = 0;
  const service = SuiteExecutionService.create({
    commands: {
      startSuiteRun: async (data) => {
        started.push(data);
      },
    },
    scenarios: createApiFixture<ScenarioApi>({
      resolveRunParametersForScenarios: options.resolve ?? resolveGold,
      queueSimulationRun: async (input) => {
        const position = dispatched++;
        if (options.refuseAt?.includes(position)) throw new Error("queue unavailable");
        queued.push(input);
      },
    }),
  });

  return { service, started, queued };
}

type ExecuteInput = Parameters<SuiteExecutionService["execute"]>[0];

function input(overrides: Partial<ExecuteInput> = {}): ExecuteInput {
  return {
    suiteId: "suite_1",
    projectId: "project_1",
    activeScenarioIds: ["scenario_1"],
    scenarioNames: new Map([["scenario_1", "Refund flow"]]),
    scenarioVersions: new Map([["scenario_1", 3]]),
    scenarioConfigs: [
      {
        id: "scenario_1",
        name: "Refund flow",
        version: 3,
        situation: "A situation",
        criteria: [],
        parameters: {},
      },
    ],
    activeTargets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: "request_1",
    ...overrides,
  };
}

describe("SuiteExecutionService", () => {
  it("starts the suite run, then hands each run to the scenario owner with its resolved values", async () => {
    const { service, started, queued } = harness();

    await service.execute(input());

    expect(started).toEqual([
      expect.objectContaining({
        scenarioSetId: "__internal__suite_1__suite",
        total: 1,
        idempotencyKey: "request_1",
      }),
    ]);
    expect(queued).toEqual([
      expect.objectContaining({
        projectId: "project_1",
        scenarioId: "scenario_1",
        setId: "__internal__suite_1__suite",
        name: "Refund flow",
        scenarioVersion: 3,
        target: { type: "http", referenceId: "agent_1" },
        parameters: { tier: "gold" },
      }),
    ]);
  });

  it("queues nothing when Scenario parameter resolution refuses the run", async () => {
    const { service, started, queued } = harness({
      resolve: () =>
        Promise.reject(Object.assign(new Error("refused"), { code: "scenario_parameter_unknown" })),
    });

    await expect(service.execute(input())).rejects.toMatchObject({
      code: "scenario_parameter_unknown",
    });
    expect(started).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("hands the encrypted values to the scenario owner apart from the plain ones", async () => {
    const { service, queued } = harness({
      resolve: async () => [
        {
          scenarioId: "scenario_1",
          parameters: { tier: "gold" },
          secretParameters: { api_token: "encrypted" },
          scenarioVersion: 3,
        },
      ],
    });

    await service.execute(input());

    expect(queued[0]).toMatchObject({
      parameters: { tier: "gold" },
      secretParameters: { api_token: "encrypted" },
    });
  });

  it("preserves client identities and fans out the filtered work", async () => {
    const { service, started, queued } = harness({
      resolve: resolveNone(["scenario_1", "scenario_2"]),
    });

    await service.execute(
      input({
        activeScenarioIds: ["scenario_1", "scenario_2"],
        activeTargets: [
          { type: "http", referenceId: "agent_1" },
          { type: "prompt", referenceId: "prompt_1" },
        ],
        repeatCount: 3,
        batchRunId: "client_batch_1",
        idempotencyKey: "client-idempotency-key",
      }),
    );

    expect(started[0]).toMatchObject({
      batchRunId: "client_batch_1",
      idempotencyKey: "client-idempotency-key",
      scenarioIds: ["scenario_1", "scenario_2"],
      targetIds: ["agent_1", "prompt_1"],
    });
    expect(queued).toHaveLength(12);
  });

  describe("given the queue refuses one run of the batch", () => {
    /** @scenario "A run the queue refused is left out of the batch it answers" */
    it("answers the runs that were queued and leaves the refused one out", async () => {
      const { service, queued } = harness({
        resolve: resolveNone(["scenario_1", "scenario_2"]),
        refuseAt: [0],
      });

      const result = await service.execute(
        input({
          activeScenarioIds: ["scenario_1", "scenario_2"],
          scenarioNames: new Map([
            ["scenario_1", "Refund flow"],
            ["scenario_2", "Login flow"],
          ]),
        }),
      );

      expect(result.jobCount).toBe(1);
      expect(result.items.map((item) => item.scenarioId)).toEqual(["scenario_2"]);
      expect(queued.map((run) => run.scenarioId)).toEqual(["scenario_2"]);
    });
  });

  describe("given a run plan configured with both simulation models", () => {
    /** @scenario "A run records the simulation models its plan was configured with" */
    it("hands both models to every queued run", async () => {
      const { service, queued } = harness();

      await service.execute(
        input({ simulatorModel: "openai/gpt-5-mini", judgeModel: "openai/gpt-5" }),
      );

      expect(queued[0]).toMatchObject({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5",
      });
    });
  });

  describe("given a run plan that names neither model", () => {
    /** @scenario "A run plan that names no model records no model" */
    it("hands no model", async () => {
      const { service, queued } = harness();

      await service.execute(input());

      expect(queued[0]?.simulatorModel ?? null).toBeNull();
      expect(queued[0]?.judgeModel ?? null).toBeNull();
    });
  });

  describe("given a run plan that names only the judge model", () => {
    /** @scenario "A plan that names only one of the two models records only that one" */
    it("hands only the judge model", async () => {
      const { service, queued } = harness();

      await service.execute(input({ judgeModel: "openai/gpt-5" }));

      expect(queued[0]?.judgeModel).toBe("openai/gpt-5");
      expect(queued[0]?.simulatorModel ?? null).toBeNull();
    });
  });

  describe("given a run started by no person", () => {
    /** @scenario "A run started by no person records no actor" */
    it("hands no actor", async () => {
      const { service, queued } = harness();

      await service.execute(input());

      expect(queued[0]?.actor).toBeUndefined();
    });
  });

  describe("given a run plan with three scenarios and two targets", () => {
    /** @scenario "Every run of a batch carries the note stamped at queue time" */
    it("hands the same note to every one of the six queued runs", async () => {
      const { service, queued } = harness({
        resolve: resolveNone(["scenario_1", "scenario_2", "scenario_3"]),
      });

      await service.execute(
        input({
          activeScenarioIds: ["scenario_1", "scenario_2", "scenario_3"],
          activeTargets: [
            { type: "http", referenceId: "agent_1" },
            { type: "http", referenceId: "agent_2" },
          ],
          note: "switched judge to the stricter criterion",
        }),
      );

      expect(queued).toHaveLength(6);
      expect(queued.map((run) => run.note)).toEqual(
        Array.from({ length: 6 }, () => "switched judge to the stricter criterion"),
      );
    });
  });

  describe("given a target that carries overrides of its own", () => {
    /** @scenario "Each target receives its own parameters merged over the run parameters" */
    it("merges them over the run's values, the target winning", async () => {
      // Echoes back the merged `values` it was resolved with, so the
      // assertions below can tell which target a call resolved for.
      const { service, queued } = harness({
        resolve: async ({ values }) => [
          {
            scenarioId: "scenario_1",
            parameters: values ?? {},
            secretParameters: {},
            scenarioVersion: 3,
          },
        ],
      });

      await service.execute(
        input({
          parameters: { region: "us-east" },
          activeTargets: [
            { type: "http", referenceId: "agent_1" },
            { type: "http", referenceId: "agent_1", runParameters: { account_tier: "silver" } },
          ],
        }),
      );

      expect(queued.map((run) => run.parameters)).toEqual([
        { region: "us-east" },
        { region: "us-east", account_tier: "silver" },
      ]);
    });
  });
});
