import { createApiFixture } from "@langwatch/api-fixture";
import {
  type ScenarioApi,
  ScenarioRunStatus,
  simulationRunDataSchema,
  Verdict,
} from "@langwatch/scenario-contract";
import { type Suite, suiteSchema, type SuiteApi } from "@langwatch/suite-contract";
import { describe, expect, it, vi } from "vitest";

import { SCENARIO_CANARY_TOTAL_BUDGET_MS } from "../../rules/scenario-canary.rules.ts";
import { type CanaryClock, ScenarioCanaryService } from "../scenario-canary.service.ts";

const PROJECT = "project-1";
const NEVER = new Promise<never>(() => undefined);

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

type LogicalClock = CanaryClock & { advance: (ms: number) => void };

function logicalClock(): LogicalClock {
  let now = 0;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    sleep: async (ms) => {
      now += Math.max(ms, 1);
    },
    raceDeadline: async ({ ms, work }) => {
      const expired = new Promise<{ timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), 5),
      );
      const raced = await Promise.race([work.then((value) => ({ value })), expired]);
      if ("timedOut" in raced) now += ms;
      return raced;
    },
  };
}

function canary({
  suites = [runPlan()],
  reads = [],
  clock = logicalClock(),
  launch,
  listByIds,
  wedgedReads = false,
}: {
  suites?: Suite[];
  reads?: ReturnType<typeof runData>[];
  clock?: LogicalClock;
  launch?: () => Promise<void>;
  listByIds?: ({ projectId, ids }: { projectId: string; ids: string[] }) => Promise<Suite[]>;
  wedgedReads?: boolean;
}) {
  let launched = 0;
  const launchRun = vi.fn(async (input: { setId?: string }) => {
    await launch?.();
    return {
      scheduled: true as const,
      setId: input.setId ?? "on-platform",
      batchRunId: "batch-1",
      scenarioRunId: `run-${++launched}`,
    };
  });
  const findScenarioRunData = () => (wedgedReads ? NEVER : Promise.resolve(reads.shift() ?? null));
  const scenarios = createApiFixture<ScenarioApi>({ launchRun, findScenarioRunData });
  const ownSuites = ({ projectId }: { projectId: string }) =>
    suites.filter((suite) => suite.projectId === projectId);
  const suiteApi = createApiFixture<SuiteApi>({
    listByIds:
      listByIds ??
      (async ({ projectId, ids }) =>
        ownSuites({ projectId }).filter((suite) => ids.includes(suite.id))),
    list: async ({ projectId }) => ownSuites({ projectId }),
  });
  const service = ScenarioCanaryService.create({
    peers: { scenarios, suites: suiteApi },
    clock,
  });
  return { service, launchRun, clock };
}

function probe(service: ScenarioCanaryService, runPlanId = "plan-1") {
  return service.run({ projectId: PROJECT, runPlanId });
}

describe("ScenarioCanaryService, as the probe spec describes it", () => {
  describe("when the run settles", () => {
    /** @scenario "A run that finishes and is judged a success is healthy" */
    it("reports healthy for a SUCCESS run judged SUCCESS", async () => {
      const { service } = canary({ reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)] });

      await expect(probe(service)).resolves.toMatchObject({ healthy: true });
    });

    /** @scenario "A run that finishes with no judge verdict is judge_failed" */
    it("reports judge_failed for a terminal run with no verdict", async () => {
      const { service } = canary({
        reads: [runData(ScenarioRunStatus.SUCCESS), runData(ScenarioRunStatus.SUCCESS)],
      });

      await expect(probe(service)).resolves.toMatchObject({
        healthy: false,
        reason: "judge_failed",
      });
    });

    /** @scenario "A run that terminates in a failure status is run_failed" */
    it.each([
      ScenarioRunStatus.ERROR,
      ScenarioRunStatus.FAILED,
      ScenarioRunStatus.CANCELLED,
      ScenarioRunStatus.STALLED,
    ])("reports run_failed for a run ending %s", async (status) => {
      const { service } = canary({ reads: [runData(status), runData(status)] });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
    });

    /** @scenario "A run the judge marks FAILURE or INCONCLUSIVE is run_failed" */
    it.each([Verdict.FAILURE, Verdict.INCONCLUSIVE])(
      "reports run_failed for a SUCCESS run judged %s",
      async (verdict) => {
        const { service } = canary({
          reads: [
            runData(ScenarioRunStatus.SUCCESS, verdict),
            runData(ScenarioRunStatus.SUCCESS, verdict),
          ],
        });

        await expect(probe(service)).resolves.toMatchObject({
          healthy: false,
          reason: "run_failed",
        });
      },
    );
  });

  describe("when the run never settles", () => {
    /** @scenario "A run that never reaches terminal within budget times out without being cancelled" */
    it("times out inside the total budget and calls nothing but launch and read", async () => {
      const { service, clock } = canary({});

      const result = await probe(service);

      expect(result).toMatchObject({ healthy: false, reason: "timeout" });
      expect(clock.now()).toBeLessThanOrEqual(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });

    /** @scenario "The probe abandons the retry once the total budget is spent" */
    it("queues no second run once the first launch spent the budget", async () => {
      const clock = logicalClock();
      const { service, launchRun } = canary({
        clock,
        launch: async () => clock.advance(SCENARIO_CANARY_TOTAL_BUDGET_MS),
      });

      const result = await probe(service);

      expect(result).toMatchObject({ healthy: false, reason: "timeout" });
      expect(launchRun).toHaveBeenCalledTimes(1);
      expect(clock.now()).toBeLessThanOrEqual(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });

    /** @scenario "The run phase shares the total budget with a preceding lookup instead of getting its own" */
    it("leaves the run phase only what the lookup did not spend", async () => {
      const clock = logicalClock();
      const { service } = canary({
        clock,
        listByIds: async () => {
          clock.advance(30_000);
          return [runPlan()];
        },
      });

      const result = await probe(service);

      expect(result).toMatchObject({ healthy: false, reason: "timeout", durationMs: 90_000 });
      expect(clock.now()).toBe(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });

    /** @scenario "A wedged datastore times out and releases the in-flight lock" */
    it("times out a wedged run read and lets the next call run", async () => {
      const { service, launchRun } = canary({ wedgedReads: true });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "timeout" });
      await expect(probe(service)).resolves.toMatchObject({ reason: "timeout" });
      expect(launchRun).toHaveBeenCalledTimes(4);
    });
  });

  describe("when the first attempt decides the retry", () => {
    /** @scenario "A first unhealthy outcome is retried once and a healthy retry reports healthy" */
    it("queues exactly two runs and reports the healthy retry", async () => {
      const { service, launchRun } = canary({
        reads: [
          runData(ScenarioRunStatus.ERROR),
          runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS),
        ],
      });

      await expect(probe(service)).resolves.toMatchObject({ healthy: true });
      expect(launchRun).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A healthy first outcome is never retried" */
    it("queues exactly one run", async () => {
      const { service, launchRun } = canary({
        reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
      });

      await expect(probe(service)).resolves.toMatchObject({ healthy: true });
      expect(launchRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the run is launched", () => {
    /** @scenario "The canary run uses the model configured on the canary scenario" */
    it("queues the run with no model or parameter override", async () => {
      const { service, launchRun } = canary({
        reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
      });

      await probe(service);

      expect(launchRun).toHaveBeenCalledWith({
        projectId: PROJECT,
        scenarioId: "scenario-1",
        target: { type: "prompt", referenceId: "prompt-1" },
        note: "scenario canary health check",
        actor: { id: "scenario-canary", label: "api" },
      });
    });

    /** @scenario "A launch-time failure is reported as unhealthy run_failed, not a raw error" */
    it("answers run_failed when the launcher throws", async () => {
      const { service } = canary({
        launch: async () => {
          throw new Error("queue unavailable");
        },
      });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
    });
  });

  describe("when canaries overlap", () => {
    /** @scenario "A concurrent canary while one is in flight starts no second run" */
    it("tells the second caller busy and queues one run", async () => {
      const { service, launchRun } = canary({
        reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
      });

      const [, second] = await Promise.all([probe(service), probe(service)]);

      expect(second).toEqual({ busy: true });
      expect(launchRun).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Two concurrent canaries for different run plans both start a run" */
    it("starts a run for each plan and tells neither busy", async () => {
      const { service, launchRun } = canary({
        suites: [runPlan(), runPlan({ id: "plan-2", slug: "canary-2" })],
        reads: [
          runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS),
          runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS),
        ],
      });

      const results = await Promise.all([probe(service, "plan-1"), probe(service, "plan-2")]);

      expect(results).not.toContainEqual({ busy: true });
      expect(launchRun).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the run plan is resolved", () => {
    /** @scenario "A run plan may be named by its slug" */
    it("launches through the plan its slug names", async () => {
      const { service, launchRun } = canary({
        reads: [runData(ScenarioRunStatus.SUCCESS, Verdict.SUCCESS)],
      });

      await expect(probe(service, "canary")).resolves.toMatchObject({ healthy: true });
      expect(launchRun).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "scenario-1" }));
    });

    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it.each([
      ["a missing plan", []],
      ["two scenarios", [runPlan({ scenarioIds: ["a", "b"] })]],
      ["no target", [runPlan({ targets: [] })]],
      [
        "two targets",
        [
          runPlan({
            targets: [
              { type: "prompt", referenceId: "p-1" },
              { type: "prompt", referenceId: "p-2" },
            ],
          }),
        ],
      ],
    ])("rejects %s before launching", async (_name, suites: Suite[]) => {
      const { service, launchRun } = canary({ suites });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run plan belonging to another project reports run_failed without launching a run" */
    it("does not resolve another project's plan", async () => {
      const { service, launchRun } = canary({ suites: [runPlan({ projectId: "project-2" })] });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run plan lookup failure degrades to run_failed, not a raw error" */
    it("catches a throwing lookup", async () => {
      const { service, launchRun } = canary({
        listByIds: async () => {
          throw new Error("database is down");
        },
      });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "An archived run plan is rejected without launching a run" */
    it("rejects an archived plan", async () => {
      const { service, launchRun } = canary({ suites: [runPlan({ archivedAt: new Date(0) })] });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A suite that is not a run plan is rejected without launching a run" */
    it("rejects a test suite", async () => {
      const { service, launchRun } = canary({ suites: [runPlan({ kind: "test_suite" })] });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A wedged run plan lookup reports unhealthy timeout without launching a run" */
    it("times out a lookup that never settles and holds no lock", async () => {
      const { service, launchRun } = canary({ listByIds: () => NEVER });

      await expect(probe(service)).resolves.toMatchObject({ healthy: false, reason: "timeout" });
      await expect(probe(service)).resolves.toMatchObject({ reason: "timeout" });
      expect(launchRun).not.toHaveBeenCalled();
    });
  });
});
