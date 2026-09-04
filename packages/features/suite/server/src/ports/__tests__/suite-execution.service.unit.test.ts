import { ScenarioService } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import { SuiteRunCommandsPort, SuiteRunIdPort } from "../suite-execution.port";
import { SuiteExecutionService } from "../../services/suite-execution.service";

class Commands extends SuiteRunCommandsPort {
  readonly startSuiteRun = vi.fn().mockResolvedValue(undefined);
  readonly queueSimulationRun = vi.fn().mockResolvedValue(undefined);
}

class Ids extends SuiteRunIdPort {
  private index = 0;
  next(): string {
    this.index += 1;
    return `run_${this.index}`;
  }
}

function scenarios(
  resolve = vi
    .fn()
    .mockResolvedValue([
      { scenarioId: "scenario_1", parameters: { tier: "gold" }, secretParameters: {} },
    ]),
): ScenarioService {
  return Object.assign(Object.create(ScenarioService.prototype), {
    resolveRunParametersForScenarios: resolve,
  });
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
    activeTargets: [{ type: "http" as const, referenceId: "agent_1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: "request_1",
    ...overrides,
  };
}

describe("SuiteExecutionService", () => {
  it("resolves parameters then emits the stable Suite and Simulation command payloads", async () => {
    const commands = new Commands();
    const service = SuiteExecutionService.create({
      commands,
      ids: new Ids(),
      scenarios: scenarios(),
    });
    await service.execute(input());
    expect(commands.startSuiteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioSetId: "__internal__suite_1__suite",
        total: 1,
        idempotencyKey: "request_1",
      }),
    );
    expect(commands.queueSimulationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioRunId: "run_1",
        scenarioSetId: "__internal__suite_1__suite",
        metadata: expect.objectContaining({ parameters: { tier: "gold" } }),
      }),
    );
  });

  it("does not emit durable commands when Scenario parameter resolution refuses the run", async () => {
    const commands = new Commands();
    const service = SuiteExecutionService.create({
      commands,
      ids: new Ids(),
      scenarios: scenarios(vi.fn().mockRejectedValue({ code: "scenario_parameter_unknown" })),
    });
    await expect(service.execute(input())).rejects.toMatchObject({
      code: "scenario_parameter_unknown",
    });
    expect(commands.startSuiteRun).not.toHaveBeenCalled();
    expect(commands.queueSimulationRun).not.toHaveBeenCalled();
  });

  it("keeps encrypted parameters outside metadata while still scheduling the run", async () => {
    const commands = new Commands();
    const service = SuiteExecutionService.create({
      commands,
      ids: new Ids(),
      scenarios: scenarios(
        vi.fn().mockResolvedValue([
          {
            scenarioId: "scenario_1",
            parameters: { tier: "gold" },
            secretParameters: { api_token: "encrypted" },
          },
        ]),
      ),
    });
    await service.execute(input());
    expect(commands.queueSimulationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        secretParameters: { api_token: "encrypted" },
        metadata: expect.objectContaining({
          parameters: { tier: "gold" },
          secretParameterNames: ["api_token"],
        }),
      }),
    );
  });

  it("preserves client identities and fans out the filtered work", async () => {
    const commands = new Commands();
    const service = SuiteExecutionService.create({
      commands,
      ids: new Ids(),
      scenarios: scenarios(
        vi.fn().mockResolvedValue([
          { scenarioId: "scenario_1", parameters: {}, secretParameters: {} },
          { scenarioId: "scenario_2", parameters: {}, secretParameters: {} },
        ]),
      ),
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

    expect(commands.startSuiteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        batchRunId: "client_batch_1",
        idempotencyKey: "client-idempotency-key",
        scenarioIds: ["scenario_1", "scenario_2"],
        targetIds: ["agent_1", "prompt_1"],
      }),
    );
    expect(commands.queueSimulationRun).toHaveBeenCalledTimes(12);
  });

  it("returns scheduled work when one durable queue dispatch fails", async () => {
    const commands = new Commands();
    commands.queueSimulationRun.mockRejectedValueOnce(new Error("queue unavailable"));
    const service = SuiteExecutionService.create({
      commands,
      ids: new Ids(),
      scenarios: scenarios(),
    });

    await expect(service.execute(input())).resolves.toMatchObject({
      batchRunId: expect.any(String),
      jobCount: 1,
    });
    expect(commands.queueSimulationRun).toHaveBeenCalledTimes(1);
  });

  describe("given a run plan configured with both simulation models", () => {
    /** @scenario "A run records the simulation models its plan was configured with" */
    it("records the simulator and judge models it was configured with", async () => {
      const commands = new Commands();
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(),
      });

      await service.execute(
        input({ simulatorModel: "openai/gpt-5-mini", judgeModel: "openai/gpt-5" }),
      );

      expect(commands.queueSimulationRun).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            langwatch: expect.objectContaining({
              simulatorModel: "openai/gpt-5-mini",
              judgeModel: "openai/gpt-5",
            }),
          }),
        }),
      );
    });
  });

  describe("given a run plan that names neither model", () => {
    /** @scenario "A run plan that names no model records no model" */
    it("records neither model", async () => {
      const commands = new Commands();
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(),
      });

      await service.execute(input());

      const call = commands.queueSimulationRun.mock.calls[0]?.[0] as {
        metadata: { langwatch: Record<string, unknown> };
      };
      expect(call.metadata.langwatch).not.toHaveProperty("simulatorModel");
      expect(call.metadata.langwatch).not.toHaveProperty("judgeModel");
    });
  });

  describe("given a run plan that names only the judge model", () => {
    /** @scenario "A plan that names only one of the two models records only that one" */
    it("records only the judge model", async () => {
      const commands = new Commands();
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(),
      });

      await service.execute(input({ judgeModel: "openai/gpt-5" }));

      const call = commands.queueSimulationRun.mock.calls[0]?.[0] as {
        metadata: { langwatch: Record<string, unknown> };
      };
      expect(call.metadata.langwatch.judgeModel).toBe("openai/gpt-5");
      expect(call.metadata.langwatch).not.toHaveProperty("simulatorModel");
    });
  });

  describe("given a run started by no person", () => {
    /** @scenario "A run started by no person records no actor" */
    it("records no actor", async () => {
      const commands = new Commands();
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(),
      });

      await service.execute(input());

      const call = commands.queueSimulationRun.mock.calls[0]?.[0] as {
        metadata: { langwatch: Record<string, unknown> };
      };
      expect(call.metadata.langwatch).not.toHaveProperty("actorId");
      expect(call.metadata.langwatch).not.toHaveProperty("actorLabel");
    });
  });

  describe("given a run plan with three scenarios and two targets", () => {
    /** @scenario "Every run of a batch carries the note stamped at queue time" */
    it("stamps the same note on every one of the six queued runs", async () => {
      const commands = new Commands();
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(
          vi.fn().mockResolvedValue([
            { scenarioId: "scenario_1", parameters: {}, secretParameters: {} },
            { scenarioId: "scenario_2", parameters: {}, secretParameters: {} },
            { scenarioId: "scenario_3", parameters: {}, secretParameters: {} },
          ]),
        ),
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

      expect(commands.queueSimulationRun).toHaveBeenCalledTimes(6);
      for (const call of commands.queueSimulationRun.mock.calls) {
        expect((call[0] as { metadata: { note?: string } }).metadata.note).toBe(
          "switched judge to the stricter criterion",
        );
      }
    });
  });

  describe("given a target that carries overrides of its own", () => {
    /** @scenario "Each target receives its own parameters merged over the run parameters" */
    it("merges them over the run's values, the target winning", async () => {
      const commands = new Commands();
      // Echoes back the merged `values` it was resolved with, so the
      // assertions below can tell which target a call resolved for.
      const resolve = vi
        .fn()
        .mockImplementation(async ({ values }: { values: Record<string, unknown> }) => [
          { scenarioId: "scenario_1", parameters: values, secretParameters: {} },
        ]);
      const service = SuiteExecutionService.create({
        commands,
        ids: new Ids(),
        scenarios: scenarios(resolve),
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

      expect(commands.queueSimulationRun).toHaveBeenCalledTimes(2);
      const [unmerged, merged] = commands.queueSimulationRun.mock.calls.map(
        (call) =>
          (call[0] as { metadata: { parameters?: Record<string, unknown> } }).metadata.parameters,
      );
      expect(unmerged).toEqual({ region: "us-east" });
      expect(merged).toEqual({ region: "us-east", account_tier: "silver" });
    });
  });
});
