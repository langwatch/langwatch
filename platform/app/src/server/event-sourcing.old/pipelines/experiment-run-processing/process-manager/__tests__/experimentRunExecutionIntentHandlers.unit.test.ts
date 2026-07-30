import { describe, expect, it, vi, type Mock } from "vitest";

import type { IntentContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import {
  createExperimentRunExecutionFailRunHandler,
  type ExperimentRunExecutionDispatchDeps,
} from "../experimentRunExecutionIntentHandlers";
import {
  EXPERIMENT_RUN_STALLED_CODE,
  type ExperimentRunExecutionFailRunIntent,
} from "../experimentRunExecutionProcess.types";

const STALLED_AT = 1_700_000_000_000;

const CTX: IntentContext = {
  processName: "experimentRunExecution",
  projectId: "project-1",
  processKey: "experiment-1:hypnotic-persimmon-turkey",
  tenantId: "project-1",
  messageKey: "fail:hypnotic-persimmon-turkey",
  attempt: 1,
};

const INTENT: ExperimentRunExecutionFailRunIntent = {
  projectId: "project-1",
  runId: "hypnotic-persimmon-turkey",
  experimentId: "experiment-1",
  stalledAt: STALLED_AT,
  code: EXPERIMENT_RUN_STALLED_CODE,
};

type CompleteRun = ExperimentRunExecutionDispatchDeps["completeRun"];
type SignalStop = ExperimentRunExecutionDispatchDeps["signalStop"];
type MarkRunFailed = ExperimentRunExecutionDispatchDeps["markRunFailed"];

/**
 * Overrides are typed as mocks, not as the plain dep signatures. Spreading
 * `Partial<ExperimentRunExecutionDispatchDeps>` widens each member to
 * `Mock | plain function`, and `.mock` does not exist on that union — so the
 * assertions below stop compiling under `typecheck:tests` while passing at
 * runtime.
 */
type MockedDispatchDeps = {
  completeRun: Mock<CompleteRun>;
  signalStop: Mock<SignalStop>;
  markRunFailed: Mock<MarkRunFailed>;
};

function makeDeps(
  overrides: Partial<MockedDispatchDeps> = {},
): MockedDispatchDeps {
  return {
    completeRun: vi.fn<CompleteRun>(async () => undefined),
    signalStop: vi.fn<SignalStop>(async () => undefined),
    markRunFailed: vi.fn<MarkRunFailed>(async () => undefined),
    ...overrides,
  };
}

describe("experimentRunExecution failRun intent", () => {
  describe("given every dependency is healthy", () => {
    /** @scenario "An experiment run whose work disappears is ended" */
    it("records the run as ended rather than finished", async () => {
      const deps = makeDeps();

      await createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX);

      // `finishedAt` would claim a partial result set is a complete one.
      expect(deps.completeRun).toHaveBeenCalledWith({
        tenantId: "project-1",
        runId: "hypnotic-persimmon-turkey",
        experimentId: "experiment-1",
        finishedAt: null,
        stoppedAt: STALLED_AT,
        occurredAt: STALLED_AT,
      });
    });

    it("gives the failure code for a stall", async () => {
      const deps = makeDeps();

      await createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.markRunFailed).toHaveBeenCalledWith({
        runId: "hypnotic-persimmon-turkey",
        code: EXPERIMENT_RUN_STALLED_CODE,
      });
    });

    /** @scenario "Ending a run stops it spending" */
    it("raises the abort flag so a still-live run stops spending", async () => {
      const deps = makeDeps();

      await createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.signalStop).toHaveBeenCalledWith({
        runId: "hypnotic-persimmon-turkey",
      });
    });
  });

  describe("when the cached progress record is gone", () => {
    /** @scenario "Recovery does not depend on a cached progress record" */
    it("still records the run's outcome", async () => {
      const deps = makeDeps({
        markRunFailed: vi.fn<MarkRunFailed>(async () => {
          throw new Error("no such key");
        }),
      });

      await createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX);

      // The guarantee is the event, not the cache. A run whose Redis record
      // expired hours ago still reaches a terminal state.
      expect(deps.completeRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the work cannot be signalled", () => {
    it("still records the run's outcome", async () => {
      const deps = makeDeps({
        signalStop: vi.fn<SignalStop>(async () => {
          throw new Error("redis down");
        }),
      });

      await createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX);

      expect(deps.completeRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the terminal write itself fails", () => {
    it("throws so the outbox retries it", async () => {
      const deps = makeDeps({
        completeRun: vi.fn<CompleteRun>(async () => {
          throw new Error("clickhouse down");
        }),
      });

      // Swallowing here would leave the run non-terminal forever, which is the
      // exact failure this process exists to remove. The completion command
      // is idempotent per run, so the retry is safe.
      await expect(
        createExperimentRunExecutionFailRunHandler(deps)(INTENT, CTX),
      ).rejects.toThrow("clickhouse down");
    });
  });

  describe("when the outbox retries the write", () => {
    it("asks for the same terminal state each time", async () => {
      const deps = makeDeps();
      const handler = createExperimentRunExecutionFailRunHandler(deps);

      await handler(INTENT, CTX);
      await handler(INTENT, { ...CTX, attempt: 2 });

      // The stall instant travels in the payload rather than being read from
      // the clock, so a retry cannot move the run's terminal time — which is
      // what lets the command's idempotency key collapse the second write.
      expect(deps.completeRun.mock.calls[0]?.[0]).toEqual(
        deps.completeRun.mock.calls[1]?.[0],
      );
    });
  });
});
