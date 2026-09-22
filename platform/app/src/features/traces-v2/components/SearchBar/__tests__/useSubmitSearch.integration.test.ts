/**
 * @vitest-environment jsdom
 *
 * What Enter does with the text in the search bar: a filter is applied as
 * typed, a sentence goes to `tracesV2.routeSearch`, and each answer lands on
 * the store or the handler it belongs to. Every failure on the way is a
 * phrase search, never an error state.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteSearchResult } from "~/server/app-layer/traces/search-router/contracts";

type MutateOptions = {
  onSuccess?: (result: RouteSearchResult) => void;
  onError?: (error: unknown) => void;
};

const mutation = {
  mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(),
  isPending: false,
};
vi.mock("~/utils/api", () => ({
  api: { tracesV2: { routeSearch: { useMutation: () => mutation } } },
}));

const project = { current: { id: "project-1" } as { id: string } | undefined };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: project.current }),
}));

import { instantEvalRunKey } from "~/server/app-layer/traces/query-language/instantEvalChips";
import { useExplorerStore } from "../../../stores/explorerStore";
import { useSubmitSearch } from "../useSubmitSearch";

const handlers = {
  onLangy: vi.fn(),
  onInstantEval: vi.fn(),
  onSupersede: vi.fn(),
  onModelUnavailable: vi.fn(),
};

function renderSubmit(
  overrides: Partial<Parameters<typeof useSubmitSearch>[0]> = {},
) {
  return renderHook(() =>
    useSubmitSearch({
      isLangyAvailable: true,
      isSamplePreview: false,
      ...handlers,
      ...overrides,
    }),
  );
}

/** The last call's input and the callbacks to answer it with. */
function lastCall(): {
  input: Record<string, unknown>;
  options: MutateOptions;
} {
  const call = mutation.mutate.mock.calls.at(-1);
  if (!call) throw new Error("routeSearch was not called");
  return { input: call[0] as Record<string, unknown>, options: call[1] };
}

beforeEach(() => {
  mutation.mutate.mockClear();
  handlers.onLangy.mockClear();
  handlers.onInstantEval.mockClear();
  handlers.onSupersede.mockClear();
  handlers.onModelUnavailable.mockClear();
  project.current = { id: "project-1" };
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({ activeLensId: "all-traces" });
});

describe("given the text has only field:value terms", () => {
  describe("when Enter is pressed", () => {
    /** @scenario "Pressing Enter applies the query" */
    it("applies the query without calling the router", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("status:error AND model:gpt-4o"));
      expect(useExplorerStore.getState().queryText).toBe(
        "status:error AND model:gpt-4o",
      );
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    /** @scenario "Enter on empty input clears the AST" */
    it("clears the query on empty text", () => {
      useExplorerStore.getState().applyQueryText("status:error");
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("   "));
      expect(useExplorerStore.getState().queryText).toBe("");
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it("surfaces a parse error for text that does not parse", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch('status:"unclosed'));
      expect(useExplorerStore.getState().parseError).not.toBeNull();
      expect(mutation.mutate).not.toHaveBeenCalled();
    });
  });
});

describe("given the text has bare words", () => {
  describe("when Enter is pressed", () => {
    /** @scenario "Enter on a sentence asks the router" */
    it("calls the router with the text, the visible range, the applied query and the lens", () => {
      useExplorerStore.getState().applyQueryText("model:gpt-4o");
      useExplorerStore
        .getState()
        .setTimeRange({ from: 1000, to: 2000, label: "Custom" });
      useExplorerStore.setState({ activeLensId: "conversations" });
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users"));
      expect(lastCall().input).toEqual({
        projectId: "project-1",
        text: "annoyed users",
        timeRange: { from: 1000, to: 2000 },
        activeQuery: "model:gpt-4o",
        lensId: "conversations",
        isLangyAvailable: true,
      });
      // Nothing lands on the store until the router answers.
      expect(useExplorerStore.getState().queryText).toBe("model:gpt-4o");
    });
  });

  describe("when the router answers filter", () => {
    /** @scenario "A sentence the filter language can express becomes chips" */
    it("applies the query and records the sentence for the notice", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("errors from gpt-4"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "filter",
          query: "status:error AND model:gpt-4*",
          decidedBy: "classifier",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe(
        "status:error AND model:gpt-4*",
      );
      expect(useExplorerStore.getState().lastAiTranslation).toEqual({
        projectId: "project-1",
        prompt: "errors from gpt-4",
        query: "status:error AND model:gpt-4*",
      });
    });
  });

  describe("when the router answers free_text", () => {
    /** @scenario "A literal phrase is searched as one phrase" */
    it("applies the phrase query", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("cannot connect to database"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "free_text",
          query: '"cannot connect to database"',
          decidedBy: "classifier",
          isModelUnavailable: false,
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe(
        '"cannot connect to database"',
      );
      expect(handlers.onModelUnavailable).not.toHaveBeenCalled();
    });

    /** @scenario "Without a classifier or a model the words are searched as a phrase" */
    it("applies the phrase and reports the missing model when flagged", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "free_text",
          query: '"annoyed users"',
          decidedBy: "fallback",
          isModelUnavailable: true,
          fellBackFrom: "routing",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe('"annoyed users"');
      expect(handlers.onModelUnavailable).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the router answers langy", () => {
    /** @scenario "A question for the assistant goes to Langy with the view attached" */
    it("hands the question to the Langy handler and leaves the query alone", () => {
      useExplorerStore.getState().applyQueryText("status:error");
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("why did errors spike"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "langy",
          question: "why did errors spike",
          decidedBy: "classifier",
        }),
      );
      expect(handlers.onLangy).toHaveBeenCalledWith("why did errors spike");
      expect(useExplorerStore.getState().queryText).toBe("status:error");
    });
  });

  describe("when the router answers instant_eval", () => {
    /** @scenario "A sentence that needs a judgement becomes an Instant Eval question" */
    it("hands the typed payload to the Instant Eval handler", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users status:error"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "instant_eval",
          question: {
            instructions: "Does the user sound annoyed?",
            criteria: ["Complains", "Stays neutral"],
          },
          target: "traces",
          otherQuery: "status:error",
          fallbackQuery: 'status:error AND "annoyed users"',
          decidedBy: "classifier",
        }),
      );
      expect(handlers.onInstantEval).toHaveBeenCalledWith({
        projectId: "project-1",
        sentence: "annoyed users",
        question: {
          instructions: "Does the user sound annoyed?",
          criteria: ["Complains", "Stays neutral"],
        },
        target: "traces",
        otherQuery: "status:error",
        fallbackQuery: 'status:error AND "annoyed users"',
        timeRange: expect.objectContaining({
          from: expect.any(Number),
          to: expect.any(Number),
        }),
      });
    });
  });

  describe("when the router call fails", () => {
    /** @scenario "A model failure is a phrase search, not an error" */
    it("searches the words as one phrase", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users status:error"));
      act(() => lastCall().options.onError?.(new Error("network")));
      expect(useExplorerStore.getState().queryText).toBe(
        'status:error AND "annoyed users"',
      );
      expect(useExplorerStore.getState().parseError).toBeNull();
    });
  });

  describe("when a second Enter comes before the first answer", () => {
    it("ignores the stale answer", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("first sentence"));
      const first = lastCall().options;
      act(() => result.current.submitSearch("second sentence"));
      act(() =>
        first.onSuccess?.({
          kind: "filter",
          query: "status:error",
          decidedBy: "classifier",
        }),
      );
      expect(useExplorerStore.getState().queryText).toBe("");
    });
  });

  describe("when the page shows sample data", () => {
    it("searches the phrase locally without calling the router", () => {
      const { result } = renderSubmit({ isSamplePreview: true });
      act(() => result.current.submitSearch("annoyed users"));
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(useExplorerStore.getState().queryText).toBe('"annoyed users"');
    });
  });
});

describe("given the text is an eval chip typed by hand", () => {
  describe("when no run has answered it", () => {
    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("applies the chip and hands the question, as written, to the Instant Eval handler", () => {
      useExplorerStore
        .getState()
        .setTimeRange({ from: 1000, to: 2000, label: "Custom" });
      const { result } = renderSubmit();
      act(() =>
        result.current.submitSearch('status:error AND eval:"the user is annoyed"'),
      );
      // The chip is on screen while the run is arranged, so the reader sees
      // what they typed rather than an empty bar.
      expect(useExplorerStore.getState().queryText).toBe(
        'status:error AND eval:"the user is annoyed"',
      );
      // No router and no model between Enter and the estimate: the reader
      // wrote the question, and the fallback keeps the chip where it is.
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(handlers.onInstantEval).toHaveBeenCalledWith({
        projectId: "project-1",
        sentence: "the user is annoyed",
        question: { instructions: "the user is annoyed" },
        target: "traces",
        otherQuery: "status:error",
        fallbackQuery: 'status:error AND eval:"the user is annoyed"',
        timeRange: { from: 1000, to: 2000 },
      });
    });

    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("judges the unit a target spelling asked for, whatever the lens shows", () => {
      const { result } = renderSubmit();
      act(() =>
        result.current.submitSearch('eval.conversation:"the user is annoyed"'),
      );
      expect(handlers.onInstantEval).toHaveBeenCalledWith(
        expect.objectContaining({ target: "threads", otherQuery: "" }),
      );
    });

    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("keeps the other eval chips beside the filter the run judges", () => {
      const { result } = renderSubmit();
      act(() =>
        result.current.submitSearch('eval.llm:"wrong tool" AND eval:"annoyed"'),
      );
      // The llm chip is pending too, so it is the first one started; the
      // annoyed chip stays in the other terms and is started on the next Enter.
      expect(handlers.onInstantEval).toHaveBeenCalledTimes(1);
      expect(handlers.onInstantEval).toHaveBeenCalledWith(
        expect.objectContaining({
          question: { instructions: "wrong tool" },
          otherQuery: 'eval:"annoyed"',
        }),
      );
    });

    it("keeps the run out of the sample preview, which has nothing to judge", () => {
      const { result } = renderSubmit({ isSamplePreview: true });
      act(() => result.current.submitSearch('eval:"the user is annoyed"'));
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(handlers.onInstantEval).not.toHaveBeenCalled();
    });
  });

  describe("when a run already answered it", () => {
    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("applies the chip and calls nothing", () => {
      const { timeRange } = useExplorerStore.getState();
      useExplorerStore.getState().registerEvalRun({
        key: instantEvalRunKey({
          question: "the user is annoyed",
          target: "traces",
          otherQuery: "",
          window: {
            from: timeRange.from,
            to: timeRange.to,
            ...(timeRange.presetId ? { presetId: timeRange.presetId } : {}),
          },
        }),
        runId: "run-1",
      });
      const { result } = renderSubmit();
      act(() => result.current.submitSearch('eval:"the user is annoyed"'));
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(handlers.onInstantEval).not.toHaveBeenCalled();
      expect(useExplorerStore.getState().queryText).toBe(
        'eval:"the user is annoyed"',
      );
    });
  });
});

describe("given an Instant Eval estimate is still in flight", () => {
  describe("when the next submit is not a judgement", () => {
    /** @scenario "A new search supersedes a pending Instant Eval" */
    it("supersedes it, whatever the new text turns out to be", () => {
      const { result } = renderSubmit();

      act(() => result.current.submitSearch("status:error"));
      expect(handlers.onSupersede).toHaveBeenCalledTimes(1);

      act(() => result.current.submitSearch(""));
      expect(handlers.onSupersede).toHaveBeenCalledTimes(2);

      act(() => result.current.submitSearch("annoyed users"));
      expect(handlers.onSupersede).toHaveBeenCalledTimes(3);
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "free_text",
          query: '"annoyed users"',
          decidedBy: "classifier",
          isModelUnavailable: false,
        }),
      );
      expect(handlers.onInstantEval).not.toHaveBeenCalled();
    });
  });
});
