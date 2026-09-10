/**
 * @vitest-environment node
 *
 * The declared `scenarios.*` transport, exercised through the real runtime:
 * what a read-only role reaches, what a run refuses before anything is queued,
 * and what the run that survives hands the application.
 *
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  getOnPlatformSetId,
  ScenarioNotFoundError,
  type QueueSimulationRunInput,
  type ScenarioApi,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { scenarioTrpcTransport } from "../scenario.trpc.ts";
import {
  scenarioTrpcCaller,
  stubScenarioApi,
  VIEWER_PERMISSIONS,
} from "./scenario-trpc.fixture.ts";

const PROJECT_ID = "project_1";
const SCENARIO_ID = "scenario_1";

function harness(app: Partial<ScenarioApi>, permissions?: readonly AuthzPermission[]) {
  return scenarioTrpcCaller({
    declaration: scenarioTrpcTransport,
    app: stubScenarioApi(app),
    ...(permissions ? { permissions } : {}),
  });
}

/** A run whose parameters resolve and whose target validates. */
function runnableApp(overrides: Partial<ScenarioApi> = {}) {
  const queueSimulationRun = vi.fn(async () => {});

  return {
    queueSimulationRun,
    app: {
      resolveRunParameters: async () => ({
        parameters: {},
        secretParameters: {},
        scenarioVersion: 4,
      }),
      prefetchExecution: async () => ({
        success: true as const,
        data: { scenario: { id: SCENARIO_ID, name: "Login flow" } },
        resolvedModels: { simulatorModel: "openai/gpt-5-mini", judgeModel: "openai/gpt-5" },
      }),
      queueSimulationRun,
      ...overrides,
    } as unknown as Partial<ScenarioApi>,
  };
}

const runInput = {
  projectId: PROJECT_ID,
  scenarioId: SCENARIO_ID,
  target: { type: "prompt" as const, referenceId: "prompt_1" },
};

describe("the scenarios tRPC transport", () => {
  describe("given the mounted router", () => {
    it("exposes the whole flat namespace the browser calls", () => {
      const { router } = harness({});

      const names = Object.keys(router._def.procedures);
      expect(names).toHaveLength(33);
      expect(names).toContain("scenarios.getAll");
      expect(names).toContain("scenarios.onSimulationUpdate");
      expect(names).toContain("scenarios.getRunConfigurations");
    });
  });

  describe("given a person with read-only access", () => {
    /** @scenario "A person with read-only access cannot move a scenario" */
    it("refuses to move a scenario", async () => {
      const moveToTestSuite = vi.fn();
      const { caller } = harness({ moveToTestSuite }, VIEWER_PERMISSIONS);

      await expect(
        caller.moveToTestSuite({
          projectId: PROJECT_ID,
          scenarioId: SCENARIO_ID,
          testSuiteId: "test_suite_1",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(moveToTestSuite).not.toHaveBeenCalled();
    });

    describe("when they open the history of a scenario", () => {
      /** @scenario "A viewer can read version history but cannot save" */
      it("lets them read every version and refuses their save", async () => {
        const update = vi.fn();
        const { caller } = harness(
          {
            update,
            listVersions: async () => ({
              versions: [version(2), version(1)],
              nextCursor: null,
            }),
            getUserProfiles: async () => [],
          },
          VIEWER_PERMISSIONS,
        );

        const history = await caller.listVersions({
          projectId: PROJECT_ID,
          scenarioId: SCENARIO_ID,
        });
        expect(history.versions.map((entry) => entry.version)).toEqual([2, 1]);

        await expect(
          caller.update({ projectId: PROJECT_ID, id: SCENARIO_ID, situation: "A viewer's save" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(update).not.toHaveBeenCalled();
      });
    });

    describe("when they try to restore a version", () => {
      /** @scenario "A viewer cannot restore a version" */
      it("refuses the restore and leaves the scenario unchanged", async () => {
        const restoreVersion = vi.fn();
        const { caller } = harness({ restoreVersion }, VIEWER_PERMISSIONS);

        await expect(
          caller.restoreVersion({ projectId: PROJECT_ID, scenarioId: SCENARIO_ID, version: 1 }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(restoreVersion).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a run whose scenario the project does not hold", () => {
    it("refuses the run as a rejected request rather than a missing page", async () => {
      const queueSimulationRun = vi.fn();
      const { caller } = harness({
        resolveRunParameters: async () => {
          throw new ScenarioNotFoundError(SCENARIO_ID);
        },
        queueSimulationRun,
      });

      await expect(caller.run(runInput)).rejects.toMatchObject({
        cause: { code: "scenario_run_rejected" },
      });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("given a target the validation prefetch refuses", () => {
    it("refuses before anything is queued", async () => {
      const queueSimulationRun = vi.fn();
      const { caller } = harness({
        resolveRunParameters: async () => ({
          parameters: {},
          secretParameters: {},
          scenarioVersion: 1,
        }),
        prefetchExecution: async () => ({
          success: false as const,
          error: "No default model is configured for this project",
        }),
        queueSimulationRun,
      } as unknown as Partial<ScenarioApi>);

      await expect(caller.run(runInput)).rejects.toMatchObject({
        cause: { code: "scenario_run_rejected" },
      });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("given a run naming no set", () => {
    /** @scenario "A scenario run that names no run set goes to the internal run set" */
    /** @scenario "A run naming no set goes to this project's one-off bucket" */
    it("queues it into this project's one-off bucket", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      const result = await caller.run(runInput);

      expect(result.setId).toBe(getOnPlatformSetId(PROJECT_ID));
      expect(queued(queueSimulationRun).setId).toBe(getOnPlatformSetId(PROJECT_ID));
    });

    /** @scenario "A batch of the internal run set carries the name of the scenario that ran" */
    it("stamps the scenario name onto the queued run", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      await caller.run(runInput);

      expect(queued(queueSimulationRun).name).toBe("Login flow");
    });

    /** @scenario "A run of a single scenario records the models the validation prefetch resolved" */
    it("hands the queued run the models the prefetch resolved", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      await caller.run(runInput);

      expect(queued(queueSimulationRun).resolvedModels).toEqual({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5",
      });
    });
  });

  describe("given a run naming a set of its own", () => {
    /** @scenario "A run naming an external set is allowed" */
    it("keeps the set the caller named", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      const result = await caller.run({ ...runInput, setId: "production-tests" });

      expect(result.setId).toBe("production-tests");
      expect(queued(queueSimulationRun).setId).toBe("production-tests");
    });

    /** @scenario "A run naming this project's own one-off set is allowed" */
    it("allows this project's own one-off set", async () => {
      const { app } = runnableApp();
      const { caller } = harness(app);
      const setId = getOnPlatformSetId(PROJECT_ID);

      await expect(caller.run({ ...runInput, setId })).resolves.toMatchObject({
        scheduled: true,
        setId,
      });
    });
  });

  describe("given a run naming a set the platform reserves", () => {
    // The internal namespace holds the one-off bucket and every run plan's
    // address. A run written into a plan's address is read as that plan's own
    // history, so it would move its pass rate, its cost and its trend.
    /** @scenario "A run naming a run plan's set address is refused" */
    it("refuses a run plan's set address", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      await expect(
        caller.run({ ...runInput, setId: "__internal__suite_abc123__suite" }),
      ).rejects.toMatchObject({ cause: { code: "scenario_reserved_set_id" } });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run naming another project's one-off set is refused" */
    it("refuses another project's one-off set", async () => {
      const { app, queueSimulationRun } = runnableApp();
      const { caller } = harness(app);

      await expect(
        caller.run({ ...runInput, setId: getOnPlatformSetId("project_someone_else") }),
      ).rejects.toMatchObject({ cause: { code: "scenario_reserved_set_id" } });
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("given a run state that names nothing", () => {
    it("answers not found rather than an empty run", async () => {
      const { caller } = harness({ tryGetScenarioRunData: async () => null });

      await expect(
        caller.getRunState({ projectId: PROJECT_ID, scenarioRunId: "scenariorun_1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

/** The first queued run, as the transport handed it over. */
function queued(mock: ReturnType<typeof vi.fn>): QueueSimulationRunInput {
  const call = mock.mock.calls[0]?.[0];
  if (!call) throw new Error("nothing was queued");

  return call as QueueSimulationRunInput;
}

/** One saved version, as the history read answers it. */
function version(number: number) {
  return {
    version: number,
    authorId: null,
    authorLabel: null,
    changeDescription: null,
    changedFields: [],
    createdAt: new Date(`2026-01-0${number}T00:00:00.000Z`),
    isSynthesized: false,
  };
}
