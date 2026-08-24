import type { SuiteRunResult } from "@langwatch/suite-contract";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { describe, expect, it, vi } from "vitest";
import { AppSuiteExecutionPort } from "../suite-run.executor";

function result(): SuiteRunResult {
  return {
    batchRunId: "batch_1",
    setId: "set_1",
    jobCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    items: [],
  };
}

function suiteRuns() {
  const startRun = vi.fn().mockResolvedValue(result());
  return {
    service: Object.assign(Object.create(SuiteRunService.prototype), { startRun }) as SuiteRunService,
    startRun,
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
    scenarioConfigs: [{
      id: "scenario_1",
      name: "Refund flow",
      situation: "A {{ params.account_tier }} customer asks for help",
      criteria: ["Answers the question"],
      parameters: [{ name: "account_tier", defaultValue: "gold" }],
    }],
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
    const port = AppSuiteExecutionPort.create({ suiteRuns: runs.service });

    await port.execute(input({ parameters: { account_tier: "platinum" } }));

    expect(runs.startRun).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: "suite_1",
      projectId: "project_1",
      scenarioNameMap: new Map([["scenario_1", "Refund flow"]]),
      parametersByScenarioId: new Map([
        ["scenario_1", { account_tier: "platinum" }],
      ]),
      idempotencyKey: "request_1",
    }));
  });

  it("rejects an invalid parameter before scheduling anything", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({ suiteRuns: runs.service });

    await expect(port.execute(input({ parameters: { accountTier: "platinum" } })))
      .rejects.toMatchObject({ code: "scenario_parameter_unknown" });
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it("encrypts secrets and keeps them out of the plain run parameters", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({ suiteRuns: runs.service });

    await port.execute(input({
      scenarioConfigs: [{
        id: "scenario_1",
        name: "Refund flow",
        situation: "A customer asks for help",
        criteria: [],
        parameters: [
          { name: "account_tier", defaultValue: "gold" },
          { name: "api_token", secret: true },
        ],
      }],
      parameters: { api_token: "tok-live-1" },
    }));

    const call = runs.startRun.mock.calls[0]?.[0];
    if (!call) throw new Error("The scheduler was not called");
    const plain = call.parametersByScenarioId.get("scenario_1");
    const encrypted = call.secretParametersByScenarioId.get("scenario_1");
    expect(plain).toEqual({ account_tier: "gold" });
    expect(encrypted).toEqual(expect.objectContaining({ api_token: expect.any(String) }));
    expect(encrypted?.api_token).not.toContain("tok-live-1");
  });

  it("passes client ids and filtered work unchanged to the scheduler", async () => {
    const runs = suiteRuns();
    const port = AppSuiteExecutionPort.create({ suiteRuns: runs.service });

    await port.execute(input({
      activeScenarioIds: ["scenario_1", "scenario_2"],
      activeTargets: [
        { type: "http", referenceId: "agent_1" },
        { type: "prompt", referenceId: "prompt_1" },
      ],
      repeatCount: 3,
      skippedArchived: { scenarios: ["scenario_old"], targets: ["agent_old"] },
      idempotencyKey: "client-idempotency-key",
      batchRunId: "client_batch_1",
    }));

    expect(runs.startRun).toHaveBeenCalledWith(expect.objectContaining({
      activeScenarioIds: ["scenario_1", "scenario_2"],
      activeTargets: [
        { type: "http", referenceId: "agent_1" },
        { type: "prompt", referenceId: "prompt_1" },
      ],
      repeatCount: 3,
      skippedArchived: { scenarios: ["scenario_old"], targets: ["agent_old"] },
      idempotencyKey: "client-idempotency-key",
      batchRunId: "client_batch_1",
    }));
  });
});
