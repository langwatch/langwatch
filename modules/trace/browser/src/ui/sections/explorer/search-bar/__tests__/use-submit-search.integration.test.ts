/**
 * @vitest-environment jsdom
 *
 * What Enter does: each router answer lands where it belongs, and every
 * failure on the way is a phrase search rather than an error state.
 */
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { instantEvalRunKey, type RouteSearchResult } from "@langwatch/trace-contract";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSubmitSearch } from "../use-submit-search.ts";

type MutateOptions = {
  onSuccess?: (result: RouteSearchResult) => void;
  onError?: (error: unknown) => void;
};

const mutation = {
  mutate: vi.fn<(input: unknown, options: MutateOptions) => void>(),
  isPending: false,
};
vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: { traces: { routeSearch: { useMutation: () => mutation } } },
}));

const project = { current: { id: "project-1" } as { id: string } | undefined };
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: project.current }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@langwatch/design-system/toaster", () => ({ toaster: { create: toast } }));

const handlers = {
  onLangy: vi.fn(),
  onInstantEval: vi.fn(),
  onSupersede: vi.fn(),
};

function renderSubmit(overrides: Partial<Parameters<typeof useSubmitSearch>[0]> = {}) {
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
function lastCall(): { input: Record<string, unknown>; options: MutateOptions } {
  const call = mutation.mutate.mock.calls.at(-1);
  if (!call) throw new Error("routeSearch was not called");
  return { input: call[0] as Record<string, unknown>, options: call[1] };
}

beforeEach(() => {
  mutation.mutate.mockClear();
  handlers.onLangy.mockClear();
  handlers.onInstantEval.mockClear();
  handlers.onSupersede.mockClear();
  toast.mockClear();
  project.current = { id: "project-1" };
  useFilterStore.getState().clearAll();
  useFilterStore.setState({ searchNotice: null });
  useFilterStore.setState({ activeLensId: "all-traces" });
});

describe("given the text has only field:value terms", () => {
  describe("when Enter is pressed", () => {
    /** @scenario "Pressing Enter applies the query" */
    it("applies the query without calling the router", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("status:error AND model:gpt-5-mini"));
      expect(useFilterStore.getState().queryText).toBe("status:error AND model:gpt-5-mini");
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    /** @scenario "Enter on empty input clears the AST" */
    it("clears the query on empty text", () => {
      useFilterStore.getState().applyQueryText("status:error");
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("   "));
      expect(useFilterStore.getState().queryText).toBe("");
      expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it("surfaces a parse error for text that does not parse", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch('status:"unclosed'));
      expect(useFilterStore.getState().parseError).not.toBeNull();
      expect(mutation.mutate).not.toHaveBeenCalled();
    });
  });
});

describe("given the text has bare words", () => {
  describe("when Enter is pressed", () => {
    /** @scenario "Enter on a sentence asks the router" */
    it("calls the router with the text, the visible range, the applied query and the lens", () => {
      useFilterStore.getState().applyQueryText("model:gpt-5-mini");
      useFilterStore.getState().setTimeRange({ from: 1000, to: 2000, label: "Custom" });
      useFilterStore.setState({ activeLensId: "conversations" });
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users"));
      expect(lastCall().input).toEqual({
        projectId: "project-1",
        text: "annoyed users",
        timeRange: { from: 1000, to: 2000 },
        activeQuery: "model:gpt-5-mini",
        lensId: "conversations",
        isLangyAvailable: true,
      });
      // Nothing lands on the store until the router answers.
      expect(useFilterStore.getState().queryText).toBe("model:gpt-5-mini");
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
      expect(useFilterStore.getState().queryText).toBe("status:error AND model:gpt-4*");
      expect(useFilterStore.getState().lastAiTranslation).toEqual({
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
        }),
      );
      expect(useFilterStore.getState().queryText).toBe(
        '"cannot connect to database"',
      );
      // The classifier's own answer, so there is nothing to explain.
      expect(useFilterStore.getState().searchNotice).toBeNull();
    });

    /** @scenario "Without a classifier or a model the words are searched as a phrase" */
    it("applies the phrase and says why it is one", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users"));
      act(() =>
        lastCall().options.onSuccess?.({
          kind: "free_text",
          query: '"annoyed users"',
          decidedBy: "fallback",
          fellBackFrom: "routing",
          modelTrouble: "no_model",
        }),
      );
      expect(useFilterStore.getState().queryText).toBe('"annoyed users"');
      expect(useFilterStore.getState().searchNotice).toEqual({
        projectId: "project-1",
        query: '"annoyed users"',
        interpretedAs: "free_text",
        modelTrouble: "no_model",
      });
    });
  });

  describe("when the router answers langy", () => {
    /** @scenario "A question for the assistant goes to Langy with the view attached" */
    it("hands the question to the Langy handler and leaves the query alone", () => {
      useFilterStore.getState().applyQueryText("status:error");
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
      expect(useFilterStore.getState().queryText).toBe("status:error");
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
    /** @scenario "A router call that fails says the words were searched instead" */
    it("searches the words as one phrase and says so", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users status:error"));
      act(() => lastCall().options.onError?.(new Error("network")));
      expect(useFilterStore.getState().queryText).toBe(
        'status:error AND "annoyed users"',
      );
      expect(useFilterStore.getState().parseError).toBeNull();
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          description: expect.stringContaining(
            "The words were searched as a phrase instead.",
          ),
        }),
      );
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
      expect(useFilterStore.getState().queryText).toBe("");
    });
  });

  describe("when the page shows sample data", () => {
    it("searches the phrase locally without calling the router", () => {
      const { result } = renderSubmit({ isSamplePreview: true });
      act(() => result.current.submitSearch("annoyed users"));
      expect(mutation.mutate).not.toHaveBeenCalled();
      expect(useFilterStore.getState().queryText).toBe('"annoyed users"');
    });
  });
});

describe("given the text is an eval chip typed by hand", () => {
  describe("when no run has answered it", () => {
    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("applies the chip and hands the question, as written, to the Instant Eval handler", () => {
      useFilterStore.getState().setTimeRange({ from: 1000, to: 2000, label: "Custom" });
      const { result } = renderSubmit();
      act(() => result.current.submitSearch('status:error AND eval:"the user is annoyed"'));
      // The chip is on screen while the run is arranged, so the reader sees
      // what they typed rather than an empty bar.
      expect(useFilterStore.getState().queryText).toBe(
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
      act(() => result.current.submitSearch('eval.conversation:"the user is annoyed"'));
      expect(handlers.onInstantEval).toHaveBeenCalledWith(
        expect.objectContaining({ target: "threads", otherQuery: "" }),
      );
    });

    /** @scenario "A chip typed by hand starts its run on Enter" */
    it("keeps the other eval chips beside the filter the run judges", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch('eval.llm:"wrong tool" AND eval:"annoyed"'));
      // The llm chip is pending too, so it is the first one started; the
      // annoyed chip stays in the other terms and starts on the next Enter.
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
      const { timeRange } = useFilterStore.getState();
      useFilterStore.getState().registerEvalRun({
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
      expect(useFilterStore.getState().queryText).toBe('eval:"the user is annoyed"');
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
        }),
      );
      expect(handlers.onInstantEval).not.toHaveBeenCalled();
    });
  });
});
