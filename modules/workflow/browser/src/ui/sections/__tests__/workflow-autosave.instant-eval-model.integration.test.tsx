/**
 * @vitest-environment jsdom
 * A Studio autosave refused because Instant Evals sits outside a judge says which node, while
 * any other failure keeps the generic status line it always showed.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
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
      message: "Instant Evals works only as an evaluator judge model.",
      meta: { places: ['node "Answer"'] },
    },
  },
};

async function autosaveFailingWith(error: unknown) {
  renderWithDesignSystem(
    <WorkflowAutosave
      isWorkflowReady
      onSave={() => Promise.reject(error)}
      onRefreshVersions={() => Promise.resolve()}
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(1100);
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
      expect(screen.getByText("Failed to autosave")).toBeTruthy();
    });
  });

  describe("when the save fails for any other reason", () => {
    /** @scenario "Any other autosave failure keeps its generic message" */
    it("shows the generic status line and raises no toast", async () => {
      await autosaveFailingWith(new Error("Network error"));

      expect(toast).not.toHaveBeenCalled();
      expect(screen.getByText("Failed to autosave")).toBeTruthy();
    });
  });
});
