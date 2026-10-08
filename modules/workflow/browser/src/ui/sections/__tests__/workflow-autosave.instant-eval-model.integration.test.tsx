/**
 * @vitest-environment jsdom
 * A Studio autosave refused because Instant Evals sits outside a judge says which node and
 * waits for the next edit, while any other failure keeps retrying with no toast.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const current = { name: "Answerer", version: "2", nodes: [], edges: [] };
const autosaved = { name: "Answerer", version: "1", nodes: [], edges: [] };

vi.mock("../../../behavior/use-workflow-store.ts", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      setWorkflow: vi.fn(),
      setAutosavedWorkflow: vi.fn(),
      hasPendingChanges: () => true,
      getWorkflow: () => current,
      getAutosavedWorkflow: () => autosaved,
      setCurrentVersionId: vi.fn(),
    }),
}));

const toast = vi.fn();
vi.mock("@langwatch/browser-host/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toast(...args) },
}));

import { WorkflowAutosave } from "../workflow-autosave.tsx";

/** The tRPC envelope readHandledError reads: the payload under data.error. */
const refusedForInstantEvals = {
  data: {
    error: {
      code: "instant_eval_judge_only_model",
      httpStatus: 422,
      message: "Instant Evals runs only LLM judge evaluators.",
      meta: { places: ['node "Answer"'] },
    },
  },
};

async function autosaveFailingWith(error: unknown) {
  const onSave = vi.fn(() => Promise.reject(error));
  renderWithDesignSystem(
    <WorkflowAutosave
      isWorkflowReady
      onSave={onSave}
      onRefreshVersions={() => Promise.resolve()}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  return { onSave };
}

/** Past the first retry delay of a failed save. */
async function waitPastFirstRetry() {
  await act(async () => {
    vi.advanceTimersByTime(6_000);
  });
}

describe("WorkflowAutosave", () => {
  beforeEach(() => {
    toast.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when the save is refused for Instant Evals outside a judge", () => {
    /** @scenario "An autosave refused for Instant Evals outside a judge names where it sits" */
    it("raises a toast carrying the refusal, so its copy names the node", async () => {
      await autosaveFailingWith(refusedForInstantEvals);

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", error: refusedForInstantEvals }),
      );
    });

    /** @scenario "A refused Studio autosave waits for the next edit" */
    it("does not retry it on its own", async () => {
      const { onSave } = await autosaveFailingWith(refusedForInstantEvals);

      await waitPastFirstRetry();

      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the save fails for any other reason", () => {
    /** @scenario "Any other autosave failure keeps its usual handling" */
    it("retries it and raises no toast", async () => {
      const { onSave } = await autosaveFailingWith(new Error("Network error"));

      await waitPastFirstRetry();

      expect(toast).not.toHaveBeenCalled();
      expect(onSave).toHaveBeenCalledTimes(2);
    });
  });
});
