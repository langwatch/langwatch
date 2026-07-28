import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  createScenarioExecutionFailRunHandler,
  type ScenarioExecutionDispatchDeps,
} from "../scenarioExecutionIntentHandlers";
import type { ScenarioExecutionFailRunIntent } from "../scenarioExecutionProcess.types";

const CTX: IntentContext = {
  processName: "scenarioExecution",
  projectId: "project-1",
  processKey: "run-1",
  tenantId: "project-1",
  messageKey: "fail:run-1",
  attempt: 1,
};

const INTENT: ScenarioExecutionFailRunIntent = {
  projectId: "project-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  setId: "set-1",
  cancelled: false,
  reason: "Scenario run stopped reporting progress",
};

type EmitFailure = ScenarioExecutionDispatchDeps["emitFailure"];
type LookupScenario = ScenarioExecutionDispatchDeps["lookupScenario"];

function makeDeps(overrides: Partial<ScenarioExecutionDispatchDeps> = {}) {
  return {
    emitFailure: vi.fn<EmitFailure>(async () => undefined),
    lookupScenario: vi.fn<LookupScenario>(async () => ({
      name: "Refund flow",
      situation: "A cross customer",
    })),
    ...overrides,
  };
}

describe("scenarioExecution failRun intent", () => {
  describe("given the scenario is readable", () => {
    /** @scenario "A reaped run reads like any other in the list" */
    it("carries the scenario's display fields onto the terminal write", async () => {
      const deps = makeDeps();

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          name: "Refund flow",
          description: "A cross customer",
          error: "Scenario run stopped reporting progress",
          cancelled: false,
        }),
      );
    });
  });

  describe("when the scenario cannot be read", () => {
    it("still writes the terminal state", async () => {
      const deps = makeDeps({
        lookupScenario: vi.fn<LookupScenario>(async () => {
          throw new Error("pg down");
        }),
      });

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      // Display fields are cosmetic. Losing them must never cost the run the
      // terminal state this process exists to write.
      expect(deps.emitFailure).toHaveBeenCalledTimes(1);
      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          error: "Scenario run stopped reporting progress",
          name: undefined,
          description: undefined,
        }),
      );
    });

    it("still writes the terminal state when the scenario is simply gone", async () => {
      const deps = makeDeps({
        lookupScenario: vi.fn<LookupScenario>(async () => null),
      });

      await createScenarioExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.emitFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the terminal write itself fails", () => {
    it("throws so the outbox retries it", async () => {
      const deps = makeDeps({
        emitFailure: vi.fn<EmitFailure>(async () => {
          throw new Error("clickhouse down");
        }),
      });

      // Swallowing here would leave the run non-terminal forever, which is the
      // exact failure this process exists to remove. `finishRun` is idempotent,
      // so the retry is safe.
      await expect(
        createScenarioExecutionFailRunHandler(deps)(INTENT, CTX),
      ).rejects.toThrow("clickhouse down");
    });
  });

  describe("given the run was cancelled", () => {
    it("passes the cancellation through so it is not recorded as an error", async () => {
      const deps = makeDeps();

      await createScenarioExecutionFailRunHandler(deps)(
        {
          ...INTENT,
          cancelled: true,
          reason: "Cancelled — no worker reported the run finished",
        },
        CTX,
      );

      expect(deps.emitFailure).toHaveBeenCalledWith(
        expect.objectContaining({ cancelled: true }),
      );
    });
  });
});
