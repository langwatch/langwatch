import { createApiFixture } from "@langwatch/api-fixture";
import {
  ChildProcessJobDataSchema,
  type ScenarioApi,
  ScenarioRunStatus,
  simulationRunDataSchema,
  Verdict,
} from "@langwatch/scenario-contract";
import { type Suite, suiteSchema, type SuiteApi } from "@langwatch/suite-contract";
import { describe, expect, it, vi } from "vitest";

import { type CanaryClock, ScenarioCanaryService } from "../scenario-canary.service.ts";

const PROJECT = "project-1";

function runPlan(overrides: Partial<Suite> = {}): Suite {
  return suiteSchema.parse({
    id: "plan-1",
    projectId: PROJECT,
    name: "Canary",
    slug: "canary",
    kind: "run_plan",
    description: null,
    scenarioIds: ["scenario-1"],
    scope: null,
    targets: [{ type: "prompt", referenceId: "prompt-1" }],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });
}

function runData(status: ScenarioRunStatus, verdict?: Verdict) {
  return simulationRunDataSchema.parse({
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    scenarioRunId: "run-1",
    status,
    results: verdict ? { verdict, metCriteria: [], unmetCriteria: [] } : null,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
  });
}

function fakeClock(): CanaryClock {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += Math.max(ms, 1);
    },
    raceDeadline: async ({ work }) => ({ value: await work }),
  };
}

function canary({
  suites = [runPlan()],
  reads,
}: {
  suites?: Suite[];
  reads: ReturnType<typeof runData>[];
}) {
  const queueSimulationRun = vi.fn(async () => {});
  const findScenarioRunData = vi.fn(async () => reads.shift() ?? null);
  const scenarios = createApiFixture<ScenarioApi>({
    resolveRunParameters: async () => ({
      parameters: {},
      secretParameters: {},
      scenarioVersion: 1,
    }),
    prefetchExecution: async (input) => ({
      success: true,
      data: ChildProcessJobDataSchema.parse({
        context: input.context,
        scenario: { id: "scenario-1", name: "Greets", situation: "", criteria: [], labels: [] },
        adapterData: { type: "connected", agentId: "a", endpoint: "http://x", timeoutMs: 1 },
        modelParams: { api_key: "k", model: "openai/gpt-5-mini" },
        nlpServiceUrl: "http://nlp",
        target: input.target,
      }),
      telemetry: { endpoint: "http://x", apiKey: "k" },
      resolvedModels: null,
    }),
    queueSimulationRun,
    findScenarioRunData,
  });
  const suiteApi = createApiFixture<SuiteApi>({
    listByIds: async ({ ids }) => suites.filter((suite) => ids.includes(suite.id)),
    list: async () => suites,
  });
  const service = ScenarioCanaryService.create({
    peers: { scenarios, suites: suiteApi },
    clock: fakeClock(),
  });
  return { service, queueSimulationRun };
}

describe("ScenarioCanaryService", () => {
  /** @scenario "The scenario canary reports healthy when the judged run succeeds" */
  it("reports healthy once the run is terminal and judged a success", async () => {
    const { service, queueSimulationRun } = canary({
      reads: [
        runData(ScenarioRunStatus.RUNNING),
        runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS),
      ],
    });

    const result = await service.run({ projectId: PROJECT, runPlanId: "plan-1" });

    expect(result).toMatchObject({ healthy: true });
    expect(queueSimulationRun).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { id: "scenario-canary", label: "api" }, name: "Greets" }),
    );
  });

  /** @scenario "The scenario canary retries once after an unhealthy first run" */
  it("launches a second run when the first fails, and reports the second", async () => {
    const { service, queueSimulationRun } = canary({
      reads: [
        runData(ScenarioRunStatus.ERROR),
        runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS),
      ],
    });

    const result = await service.run({ projectId: PROJECT, runPlanId: "plan-1" });

    expect(result).toMatchObject({ healthy: true });
    expect(queueSimulationRun).toHaveBeenCalledTimes(2);
  });

  /** @scenario "The scenario canary reports judge_failed when a successful run carries no verdict" */
  it("reports judge_failed for a successful run without a verdict", async () => {
    const { service } = canary({
      reads: [runData(ScenarioRunStatus.SUCCESS), runData(ScenarioRunStatus.SUCCESS)],
    });

    const result = await service.run({ projectId: PROJECT, runPlanId: "plan-1" });

    expect(result).toMatchObject({ healthy: false, reason: "judge_failed" });
  });

  /** @scenario "The scenario canary reports timeout when the run never settles" */
  it("reports timeout when no terminal status arrives within the budget", async () => {
    const { service } = canary({ reads: [] });

    const result = await service.run({ projectId: PROJECT, runPlanId: "plan-1" });

    expect(result).toMatchObject({ healthy: false, reason: "timeout" });
  });

  /** @scenario "A run plan that names more than one scenario launches nothing" */
  it("reports run_failed without launching for a plan with two scenarios", async () => {
    const { service, queueSimulationRun } = canary({
      suites: [runPlan({ scenarioIds: ["a", "b"] })],
      reads: [],
    });

    const result = await service.run({ projectId: PROJECT, runPlanId: "plan-1" });

    expect(result).toEqual({ healthy: false, reason: "run_failed", durationMs: 0 });
    expect(queueSimulationRun).not.toHaveBeenCalled();
  });

  /** @scenario "The scenario canary finds a run plan by its slug" */
  it("resolves a run plan named by its slug", async () => {
    const { service } = canary({
      reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
    });

    const result = await service.run({ projectId: PROJECT, runPlanId: "canary" });

    expect(result).toMatchObject({ healthy: true });
  });

  /** @scenario "A second probe of the same run plan while one is in flight is told busy" */
  it("answers busy to a concurrent probe of the same plan", async () => {
    const { service } = canary({
      reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
    });

    const [first, second] = await Promise.all([
      service.run({ projectId: PROJECT, runPlanId: "plan-1" }),
      service.run({ projectId: PROJECT, runPlanId: "canary" }),
    ]);

    expect(first).toMatchObject({ healthy: true });
    expect(second).toEqual({ busy: true });
  });
});
