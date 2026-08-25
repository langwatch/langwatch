import { describe, expect, it, vi } from "vitest";
import { AppSuiteExecutionPort } from "../suite-execution.adapter";

function suiteRuns() {
  return {
    startRun: vi.fn().mockResolvedValue(undefined),
    queueRun: vi.fn().mockResolvedValue(undefined),
  };
}

function input(
  overrides: Partial<Parameters<AppSuiteExecutionPort["execute"]>[0]> = {},
): Parameters<AppSuiteExecutionPort["execute"]>[0] {
  return {
    suiteId: "suite_1",
    projectId: "project_1",
    activeScenarioIds: ["scenario_1"],
    scenarioNames: new Map([["scenario_1", "Refund flow"]]),
    scenarioConfigs: [
      {
        id: "scenario_1",
        name: "Refund flow",
        situation: "A {{ params.account_tier }} customer asks for help",
        criteria: ["Answers the question"],
        parameters: [{ name: "account_tier", defaultValue: "gold" }],
      },
    ],
    activeTargets: [{ type: "http" as const, referenceId: "agent_1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: "request_1",
    ...overrides,
  };
}

describe("AppSuiteExecutionPort", () => {
  it("resolves defaults and caller values before recording the run", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({
      startSuiteRun: runs.startRun,
      queueSimulationRun: runs.queueRun,
    });

    await port.execute(input({ parameters: { account_tier: "platinum" } }));

    expect(runs.startRun.mock.calls[0]?.[0]).toEqual({
      tenantId: "project_1",
      batchRunId: expect.any(String),
      scenarioSetId: "__internal__suite_1__suite",
      suiteId: "suite_1",
      total: 1,
      scenarioIds: ["scenario_1"],
      targetIds: ["agent_1"],
      idempotencyKey: "request_1",
      occurredAt: expect.any(Number),
    });
    expect(runs.queueRun.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        tenantId: "project_1",
        scenarioId: "scenario_1",
        batchRunId: expect.any(String),
        scenarioSetId: "__internal__suite_1__suite",
        name: "Refund flow",
        metadata: {
          langwatch: { targetReferenceId: "agent_1" },
          parameters: { account_tier: "platinum" },
        },
        target: { type: "http", referenceId: "agent_1" },
        occurredAt: expect.any(Number),
      }),
    );
  });

  it("rejects an invalid parameter before scheduling anything", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({
      startSuiteRun: runs.startRun,
      queueSimulationRun: runs.queueRun,
    });

    await expect(
      port.execute(input({ parameters: { accountTier: "platinum" } })),
    ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it("encrypts secrets and keeps them out of the plain run parameters", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({
      startSuiteRun: runs.startRun,
      queueSimulationRun: runs.queueRun,
    });

    await port.execute(
      input({
        scenarioConfigs: [
          {
            id: "scenario_1",
            name: "Refund flow",
            situation: "A customer asks for help",
            criteria: [],
            parameters: [
              { name: "account_tier", defaultValue: "gold" },
              { name: "api_token", secret: true },
            ],
          },
        ],
        parameters: { api_token: "tok-live-1" },
      }),
    );

    const call = runs.queueRun.mock.calls[0]?.[0];
    if (!call) throw new Error("The scheduler was not called");
    const plain = call.metadata.parameters;
    const encrypted = call.secretParameters;
    expect(plain).toEqual({ account_tier: "gold" });
    expect(encrypted).toEqual(expect.objectContaining({ api_token: expect.any(String) }));
    expect(encrypted?.api_token).not.toContain("tok-live-1");
    expect(call.metadata).toEqual({
      langwatch: { targetReferenceId: "agent_1" },
      parameters: { account_tier: "gold" },
      secretParameterNames: ["api_token"],
    });
  });

  it("passes client ids and filtered work unchanged to the scheduler", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({
      startSuiteRun: runs.startRun,
      queueSimulationRun: runs.queueRun,
    });

    await port.execute(
      input({
        activeScenarioIds: ["scenario_1", "scenario_2"],
        activeTargets: [
          { type: "http", referenceId: "agent_1" },
          { type: "prompt", referenceId: "prompt_1" },
        ],
        repeatCount: 3,
        skippedArchived: { scenarios: ["scenario_old"], targets: ["agent_old"] },
        idempotencyKey: "client-idempotency-key",
        batchRunId: "client_batch_1",
      }),
    );

    expect(runs.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioIds: ["scenario_1", "scenario_2"],
        targetIds: ["agent_1", "prompt_1"],
        idempotencyKey: "client-idempotency-key",
        batchRunId: "client_batch_1",
      }),
    );
    expect(runs.queueRun).toHaveBeenCalledTimes(12);
  });

  it("continues returning scheduled work when an individual queue dispatch fails", async () => {
    const runs = suiteRuns();
    runs.queueRun.mockRejectedValueOnce(new Error("queue unavailable"));
    const port = AppSuiteExecutionPort.create({
      startSuiteRun: runs.startRun,
      queueSimulationRun: runs.queueRun,
    });

    await expect(port.execute(input())).resolves.toMatchObject({
      jobCount: 1,
      batchRunId: expect.any(String),
    });
    expect(runs.queueRun).toHaveBeenCalledTimes(1);
  });
});
