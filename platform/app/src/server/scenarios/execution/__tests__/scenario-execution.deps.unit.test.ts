import { describe, expect, it, vi } from "vitest";

import { scenarioExecutionIntents } from "~/server/event-sourcing/simulation-processing/scenarioExecution.process";
import type { ScenarioExecutionDispatcherHandle } from "../execution-dispatcher";
import {
  createScenarioExecutionDispatchDeps,
  type ScenarioTerminalWriter,
} from "../scenario-execution.deps";

const PAYLOAD = {
  projectId: "project-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "prompt" as const, referenceId: "prompt-1" },
};

function harness(options?: {
  statuses?: (string | null)[];
  execute?: () => Promise<void>;
  scenario?: { name: string; situation: string } | null;
  scenarioError?: Error;
}) {
  const execute = vi.fn(options?.execute ?? (() => Promise.resolve()));
  const dispatcher: ScenarioExecutionDispatcherHandle = {
    setPool: vi.fn(),
    execute,
  };

  const statuses = options?.statuses ?? [null];
  let call = 0;
  const getRunStatus = vi.fn(() =>
    Promise.resolve(statuses[Math.min(call++, statuses.length - 1)] ?? null),
  );

  const getById = vi.fn(() =>
    options?.scenarioError
      ? Promise.reject(options.scenarioError)
      : Promise.resolve(
          options?.scenario === undefined
            ? { name: "Refund flow", situation: "User wants a refund" }
            : options.scenario,
        ),
  );
  const ensureFailureEventsEmitted = vi.fn<
    ScenarioTerminalWriter["ensureFailureEventsEmitted"]
  >(() => Promise.resolve());

  const deps = createScenarioExecutionDispatchDeps({
    dispatcher,
    runStatus: { getRunStatus },
    scenarios: { getById },
    terminalWriter: { ensureFailureEventsEmitted },
  });

  return {
    deps,
    execute,
    getRunStatus,
    getById,
    ensureFailureEventsEmitted,
    // The real intent handler, so the guard that decides whether to execute is
    // exercised against these adapters rather than restated by the test.
    deliver: (payload = PAYLOAD) =>
      scenarioExecutionIntents(deps).executeRun.deliver(payload),
  };
}

describe("scenario execution dispatch deps", () => {
  describe("given a run that has been queued against a target", () => {
    describe("when its dispatch is delivered", () => {
      /** @scenario "A queued run is handed to the executor" */
      it("executes the run against its target", async () => {
        const h = harness({ statuses: ["QUEUED"] });

        await h.deliver();

        expect(h.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-1",
            scenarioRunId: "run-1",
            scenarioId: "scenario-1",
            batchRunId: "batch-1",
            setId: "set-1",
            target: { type: "prompt", referenceId: "prompt-1" },
          }),
        );
      });
    });

    describe("when nothing has been recorded about the run yet", () => {
      /** @scenario "A run nothing is stored about yet is still executed" */
      it("executes the run rather than skipping it", async () => {
        const h = harness({ statuses: [null] });

        await h.deliver();

        expect(h.execute).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the run is already under way", () => {
      /** @scenario "A run that is already under way is not started a second time" */
      it("leaves the run alone", async () => {
        const h = harness({ statuses: ["IN_PROGRESS"] });

        await h.deliver();

        expect(h.execute).not.toHaveBeenCalled();
      });
    });

    describe("when the run already finished", () => {
      /** @scenario "A run that already finished is not started again" */
      it("leaves the run alone", async () => {
        const h = harness({ statuses: ["SUCCESS"] });

        await h.deliver();

        expect(h.execute).not.toHaveBeenCalled();
      });
    });

    describe("when the same dispatch arrives twice", () => {
      /** @scenario "Whether the run already started is read from the durable record" */
      it("re-reads the stored status per delivery rather than reusing the first answer", async () => {
        const h = harness({ statuses: ["QUEUED", "IN_PROGRESS"] });

        await h.deliver();
        await h.deliver();

        expect(h.getRunStatus).toHaveBeenCalledTimes(2);
        expect(h.execute).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the stored status cannot be read at all", () => {
      it("propagates the failure instead of executing the run", async () => {
        const h = harness();
        h.getRunStatus.mockRejectedValueOnce(new Error("clickhouse down"));

        await expect(h.deliver()).rejects.toThrow("clickhouse down");
        expect(h.execute).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a run that cannot be handed to the executor", () => {
    describe("when its dispatch is delivered", () => {
      /** @scenario "A fault while starting the run is recorded against it" */
      it("records the run as failed rather than leaving it queued", async () => {
        const h = harness({
          statuses: ["QUEUED"],
          execute: () => Promise.reject(new Error("no executor here")),
        });

        await h.deliver();

        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioRunId: "run-1",
            outcome: "error",
            error: "no executor here",
          }),
        );
      });

      /** @scenario "A recorded failure carries the scenario's name and description" */
      it("records the scenario's name and description with the failure", async () => {
        const h = harness({
          statuses: ["QUEUED"],
          execute: () => Promise.reject(new Error("no executor here")),
        });

        await h.deliver();

        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Refund flow",
            description: "User wants a refund",
          }),
        );
      });
    });
  });

  describe("given a run whose scenario can no longer be read", () => {
    describe("when the run is recorded as failed", () => {
      /** @scenario "A run whose scenario can no longer be looked up is still ended" */
      it("still writes the terminal record, without the name", async () => {
        const h = harness({ scenarioError: new Error("scenario gone") });

        await h.deps.emitFailure({
          projectId: "project-1",
          scenarioId: "scenario-1",
          setId: "set-1",
          batchRunId: "batch-1",
          scenarioRunId: "run-1",
          error: "the worker executing it is no longer alive",
          outcome: "stalled",
        });

        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledTimes(1);
        const written = h.ensureFailureEventsEmitted.mock
          .calls[0]![0] as Record<string, unknown>;
        expect(written.outcome).toBe("stalled");
        expect(written.name).toBeUndefined();
      });
    });

    describe("when the run never named its scenario at all", () => {
      it("writes the terminal record without looking a scenario up", async () => {
        const h = harness();

        await h.deps.emitFailure({
          projectId: "project-1",
          scenarioId: "",
          setId: "set-1",
          batchRunId: "batch-1",
          scenarioRunId: "run-1",
          error: "the worker executing it is no longer alive",
          outcome: "stalled",
        });

        expect(h.getById).not.toHaveBeenCalled();
        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the user asked to cancel the run", () => {
    describe("when the run is recorded as ended", () => {
      /** @scenario "A run the user cancelled is recorded as cancelled, not as an error" */
      it("records it as cancelled", async () => {
        const h = harness();

        await h.deps.emitFailure({
          projectId: "project-1",
          scenarioId: "scenario-1",
          setId: "set-1",
          batchRunId: "batch-1",
          scenarioRunId: "run-1",
          error: "nobody honoured the cancellation",
          outcome: "cancelled",
        });

        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: "cancelled" }),
        );
      });
    });

    describe("when the outcome is one this seam does not recognise", () => {
      it("still ends the run, under the default outcome", async () => {
        const h = harness();

        await h.deps.emitFailure({
          projectId: "project-1",
          scenarioId: "scenario-1",
          setId: "set-1",
          batchRunId: "batch-1",
          scenarioRunId: "run-1",
          error: "something new",
          outcome: "evaporated",
        });

        expect(h.ensureFailureEventsEmitted).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: "error" }),
        );
      });
    });
  });
});
