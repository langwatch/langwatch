/**
 * @vitest-environment jsdom
 *
 * What Enter does: each router answer lands where it belongs, and every
 * failure on the way is a phrase search rather than an error state.
 */
import { useFilterStore } from "@langwatch/trace-browser-kit";
import type { RouteSearchResult } from "@langwatch/trace-contract";
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

const handlers = {
  onLangy: vi.fn(),
  onInstantEval: vi.fn(),
  onSupersede: vi.fn(),
  onModelUnavailable: vi.fn(),
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
  handlers.onModelUnavailable.mockClear();
  project.current = { id: "project-1" };
  useFilterStore.getState().clearAll();
  useFilterStore.setState({ activeLensId: "all-traces" });
});

describe("given the text has only field:value terms", () => {
  describe("when Enter is pressed", () => {
    /** @scenario "Pressing Enter applies the query" */
    it("applies the query without calling the router", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("status:error AND model:gpt-4o"));
      expect(useFilterStore.getState().queryText).toBe("status:error AND model:gpt-4o");
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
      useFilterStore.getState().applyQueryText("model:gpt-4o");
      useFilterStore.getState().setTimeRange({ from: 1000, to: 2000, label: "Custom" });
      useFilterStore.setState({ activeLensId: "conversations" });
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
      expect(useFilterStore.getState().queryText).toBe("model:gpt-4o");
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
          isModelUnavailable: false,
        }),
      );
      expect(useFilterStore.getState().queryText).toBe('"cannot connect to database"');
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
      expect(useFilterStore.getState().queryText).toBe('"annoyed users"');
      expect(handlers.onModelUnavailable).toHaveBeenCalledTimes(1);
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
    it("searches the words as one phrase", () => {
      const { result } = renderSubmit();
      act(() => result.current.submitSearch("annoyed users status:error"));
      act(() => lastCall().options.onError?.(new Error("network")));
      expect(useFilterStore.getState().queryText).toBe('status:error AND "annoyed users"');
      expect(useFilterStore.getState().parseError).toBeNull();
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
