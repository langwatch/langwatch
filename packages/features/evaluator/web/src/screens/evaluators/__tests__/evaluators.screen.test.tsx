/**
 * @vitest-environment jsdom
 *
 * The evaluator library: what a reader sees, what a delete would take with it,
 * and which overlay each action asks the application for.
 *
 * THE PLATFORM PAGE HAD NO RENDER SUITE AT ALL. `pages/[project]/evaluators.tsx`
 * was 319 lines with three dialogs, four overlay requests and a two-branch
 * delete, and nothing mounted it. These are those behaviours, stated for the
 * first time.
 *
 * WHAT THIS FILE IS REALLY FOR is the delete. An evaluator's cascade DELETES
 * every online evaluation running on it, in production, with no undo on this
 * screen — so the two things worth pinning are that the reader is told before
 * they confirm, and that the branch is chosen by what the related-entities read
 * actually answered rather than by which button was pressed.
 *
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeEvaluatorHost, renderWithEvaluatorHost } from "../../../testing";
import EvaluatorsScreen from "../evaluators.screen";

const { state } = vi.hoisted(() => ({
  state: {
    evaluators: [] as Array<Record<string, unknown>>,
    isLoading: false,
    related: {
      workflow: null as { id: string; name: string } | null,
      monitors: [] as Array<{ id: string; name: string }>,
    },
    relatedLoading: false,
  },
}));

const calls = vi.hoisted(() => ({
  deleteEvaluator: vi.fn(),
  cascadeArchive: vi.fn(),
  syncFromSource: vi.fn(),
  invalidateAll: vi.fn(),
  invalidateLimit: vi.fn(),
}));

vi.mock("../../../behavior/evaluator-api", () => {
  const mutation = (spy: (input: unknown) => unknown) => ({
    useMutation: (options?: {
      onSuccess?: (result: unknown, variables: unknown) => void;
      onError?: (error: unknown) => void;
    }) => ({
      isPending: false,
      mutate: (
        input: unknown,
        perCall?: { onSuccess?: () => void; onError?: (error: unknown) => void },
      ) => {
        const result = spy(input);
        options?.onSuccess?.(result, input);
        perCall?.onSuccess?.();
      },
      mutateAsync: async (input: unknown) => spy(input),
    }),
  });

  return {
    evaluatorApi: {
      useUtils: () => ({
        evaluators: { getAll: { invalidate: calls.invalidateAll } },
        licenseEnforcement: { checkLimit: { invalidate: calls.invalidateLimit } },
      }),
      evaluators: {
        getAll: {
          useQuery: () => ({ data: state.evaluators, isLoading: state.isLoading }),
        },
        getRelatedEntities: {
          useQuery: () => ({ data: state.related, isLoading: state.relatedLoading }),
        },
        getCopies: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        getHistory: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
        delete: mutation(calls.deleteEvaluator),
        cascadeArchive: mutation(calls.cascadeArchive),
        syncFromSource: mutation(calls.syncFromSource),
        copy: mutation(vi.fn()),
        pushToCopies: mutation(vi.fn()),
      },
    },
  };
});

const evaluator = (overrides: Record<string, unknown> = {}) => ({
  id: "eval_1",
  name: "Answer relevancy",
  slug: "answer-relevancy",
  type: "evaluator",
  config: { evaluatorType: "langevals/answer_relevancy" },
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  state.evaluators = [evaluator()];
  state.isLoading = false;
  state.related = { workflow: null, monitors: [] };
  state.relatedLoading = false;
  calls.deleteEvaluator.mockReset().mockReturnValue({});
  calls.cascadeArchive.mockReset().mockReturnValue({
    archivedWorkflow: null,
    deletedMonitorsCount: 0,
  });
  calls.syncFromSource.mockReset().mockReturnValue({ ok: true });
  calls.invalidateAll.mockReset();
  calls.invalidateLimit.mockReset();
});

afterEach(cleanup);

describe("given a project with no evaluators", () => {
  describe("when the library is opened", () => {
    /** @scenario "An empty evaluator library explains what an evaluator is for" */
    it("says there are none yet and offers to create the first", () => {
      state.evaluators = [];
      renderWithEvaluatorHost(<EvaluatorsScreen />);

      expect(screen.getByText("No evaluators yet")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Create your first evaluator/ }),
      ).toBeInTheDocument();
    });
  });
});

describe("given a project with evaluators", () => {
  describe("when the library is opened", () => {
    /** @scenario "Each evaluator is one card" */
    it("renders one card per evaluator", () => {
      state.evaluators = [evaluator(), evaluator({ id: "eval_2", name: "Faithfulness" })];
      renderWithEvaluatorHost(<EvaluatorsScreen />);

      expect(screen.getByText("Answer relevancy")).toBeInTheDocument();
      expect(screen.getByText("Faithfulness")).toBeInTheDocument();
    });
  });

  describe("when a new evaluator is asked for", () => {
    /** @scenario "Creating an evaluator asks the application for the category picker" */
    it("asks the application for the category picker", async () => {
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /New Evaluator/ }));

      expect(host.overlays).toEqual([{ drawer: "evaluatorCategorySelector" }]);
    });
  });

  describe("when a code evaluator and a built-in one are edited", () => {
    /** @scenario "Editing a code evaluator asks for the code editor and not the settings editor" */
    it("asks for the editor each kind actually has", async () => {
      state.evaluators = [
        evaluator({ id: "eval_code", name: "Custom check", type: "code", config: {} }),
      ];
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);
      await userEvent.click(screen.getByText("Custom check"));

      expect(host.overlays).toEqual([
        { drawer: "codeEvaluatorEditor", params: { evaluatorId: "eval_code" } },
      ]);

      cleanup();
      state.evaluators = [evaluator()];
      const second = renderWithEvaluatorHost(<EvaluatorsScreen />);
      await userEvent.click(screen.getByText("Answer relevancy"));

      expect(second.host.overlays).toEqual([
        {
          drawer: "evaluatorEditor",
          params: { evaluatorId: "eval_1", evaluatorType: "langevals/answer_relevancy" },
        },
      ]);
    });
  });

  describe("when one evaluator's history is opened", () => {
    /** @scenario "The history I am reading is in the address" */
    it("puts the evaluator in the address rather than in component state", async () => {
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("View history"));

      expect(host.queries).toEqual([{ history: "eval_1" }]);
    });
  });

  describe("when a replica is pulled back in line with its source", () => {
    /** @scenario "Each evaluator is one card" */
    it("reports the update", async () => {
      state.evaluators = [evaluator({ copiedFromEvaluatorId: "eval_source" })];
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("Update from source"));

      expect(calls.syncFromSource).toHaveBeenCalledWith({
        projectId: "proj-1",
        evaluatorId: "eval_1",
      });
      expect(host.successes[0]?.title).toBe("Evaluator updated");
    });
  });
});

describe("given an evaluator other things depend on", () => {
  beforeEach(() => {
    state.related = {
      workflow: { id: "wf_1", name: "Relevancy workflow" },
      monitors: [
        { id: "mon_1", name: "Relevancy on production" },
        { id: "mon_2", name: "Relevancy on staging" },
      ],
    };
  });

  describe("when its deletion is started", () => {
    /** @scenario "A delete names what it would take with it before I confirm" */
    it("names the workflow and the online evaluations before the confirmation is armed", async () => {
      renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("Delete"));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Workflows \(1\) - will be archived/)).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Online Evaluations \(2\) - will be deleted/),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("Relevancy on production")).toBeInTheDocument();
    });

    /** @scenario "A delete is not armed until I type the confirmation" */
    it("refuses the delete until the reader types the word", async () => {
      renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("Delete"));

      const confirm = await screen.findByTestId("cascade-archive-confirm-button");
      expect(confirm).toBeDisabled();

      await userEvent.type(screen.getByTestId("cascade-archive-confirm-input"), "delete");
      expect(confirm).not.toBeDisabled();
    });

    /** @scenario "An evaluator that other things depend on is deleted with the cascade" */
    it("takes the cascade and reports what else went with it", async () => {
      calls.cascadeArchive.mockReturnValue({
        archivedWorkflow: { id: "wf_1", name: "Relevancy workflow" },
        deletedMonitorsCount: 2,
      });
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("Delete"));
      await userEvent.type(screen.getByTestId("cascade-archive-confirm-input"), "delete");
      await userEvent.click(screen.getByTestId("cascade-archive-confirm-button"));

      expect(calls.cascadeArchive).toHaveBeenCalledWith({ id: "eval_1", projectId: "proj-1" });
      expect(calls.deleteEvaluator).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(host.successes.at(-1)).toEqual({
          title: "Evaluator deleted",
          description: "Also deleted: 1 workflow, 2 online evaluations",
        }),
      );
    });
  });
});

describe("given an evaluator nothing depends on", () => {
  describe("when its deletion is confirmed", () => {
    /** @scenario "An evaluator nothing depends on is deleted without the cascade" */
    it("takes the plain delete and never the cascade", async () => {
      const { host } = renderWithEvaluatorHost(<EvaluatorsScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await userEvent.click(await screen.findByText("Delete"));
      await userEvent.type(screen.getByTestId("cascade-archive-confirm-input"), "delete");
      await userEvent.click(screen.getByTestId("cascade-archive-confirm-button"));

      expect(calls.deleteEvaluator).toHaveBeenCalledWith({ id: "eval_1", projectId: "proj-1" });
      expect(calls.cascadeArchive).not.toHaveBeenCalled();
      expect(host.successes.at(-1)).toEqual({ title: "Evaluator deleted" });
    });
  });
});

describe("given a reader who may create in one project and not another", () => {
  describe("when the replicate dialog is opened", () => {
    /** @scenario "Replicating an evaluator offers every project, and refuses the closed ones" */
    it("offers both projects and refuses to replicate into the closed one", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithEvaluatorHost(<EvaluatorsScreen />);

      await user.click(screen.getByRole("button", { name: /Actions for Answer relevancy/i }));
      await user.click(await screen.findByText("Replicate to another project"));

      const replicate = screen.getByRole("button", { name: "Replicate" });
      expect(replicate).toBeDisabled();

      await user.click(screen.getByRole("combobox"));
      const refused = await screen.findAllByRole("option", {
        name: /Acme \/ Engineering \/ Batch/,
        hidden: true,
      });
      await user.click(refused.find((option) => option.tagName === "DIV")!);

      // Choosing a project the reader may not create in must leave the action
      // refused rather than send a copy the server would reject.
      expect(replicate).toBeDisabled();
      expect(screen.getByText("(no permission)")).toBeInTheDocument();

      await user.click(screen.getByRole("combobox"));
      const allowed = await screen.findAllByRole("option", {
        name: /Acme \/ Engineering \/ Web App/,
        hidden: true,
      });
      await user.click(allowed.find((option) => option.tagName === "DIV")!);

      expect(screen.getByRole("button", { name: "Replicate" })).not.toBeDisabled();
    });
  });
});
