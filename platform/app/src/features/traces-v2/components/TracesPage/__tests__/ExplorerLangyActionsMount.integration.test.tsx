/**
 * @vitest-environment jsdom
 *
 * The Trace Explorer's side of the UI-action channel: the handlers it
 * registers with Langy, run against the real Explorer store. Langy's context
 * is the boundary and is stubbed to capture what the page registers.
 *
 * Spec: specs/langy/langy-trace-explorer-actions.feature ("The Explorer's
 * actions are typed, permissioned and advertised").
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LangyUiActionHandlers } from "~/features/langy/uiActions/types";
import { EXPLORER_ACTION_KINDS } from "../../../actions/manifest";
import { lensKeepsTheResultSet } from "../../../hooks/useExplorerLinkLensId";
import { useExplorerStore } from "../../../stores/explorerStore";
import { ExplorerLangyActionsMount } from "../ExplorerLangyActionsMount";
import { registerInstantEvalRoute } from "../instantEvalRouteBridge";

const { registerActions, clearActions } = vi.hoisted(() => ({
  registerActions: vi.fn(),
  clearActions: vi.fn(),
}));

vi.mock("~/features/langy/LangyContext", () => ({
  useRegisterLangyActions: (handlers: LangyUiActionHandlers) => {
    registerActions(handlers);
    return undefined;
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

function registered(): LangyUiActionHandlers {
  const handlers = registerActions.mock.calls.at(-1)?.[0] as
    | LangyUiActionHandlers
    | undefined;
  if (!handlers) throw new Error("the page registered nothing");
  return handlers;
}

/** Run one registered handler the way `executeUiAction` does. */
async function call(kind: string, payload: unknown): Promise<unknown> {
  const handler = registered()[kind];
  if (!handler) throw new Error(`no handler for ${kind}`);
  return await handler.run(handler.payloadSchema.parse(payload) as never);
}

/** The list has answered the state the store holds. */
function settle({ totalHits }: { totalHits: number }) {
  const store = useExplorerStore.getState();
  store.commitDebounced();
  store.setResults({
    totalHits,
    itemNoun: "traces",
    pageTraceIds: ["trace-a", "trace-b"],
    isSettled: true,
  });
}

beforeEach(() => {
  registerActions.mockClear();
  clearActions.mockClear();
  const store = useExplorerStore.getState();
  store.selectLens("all-traces", { persist: false });
  store.clearAll();
  store.clearSelection();
  store.commitDebounced();
});

afterEach(() => {
  cleanup();
});

describe("given the Trace Explorer is open", () => {
  describe("when the page mounts", () => {
    /** @scenario "The Trace Explorer registers its actions with Langy while it is open" */
    it("registers a handler for every explorer action", () => {
      render(<ExplorerLangyActionsMount />);
      expect(Object.keys(registered()).sort()).toEqual(
        [...EXPLORER_ACTION_KINDS].sort(),
      );
    });
  });

  describe("when Langy calls explorer.setFilter", () => {
    /** @scenario "explorer.setFilter applies the filter on screen and answers what was applied" */
    it("puts the query in the store the search bar reads and answers it", async () => {
      render(<ExplorerLangyActionsMount />);
      const result = await call("explorer.setFilter", {
        query: "event:thumbs_up_down",
      });
      expect(useExplorerStore.getState().queryText).toBe(
        "event:thumbs_up_down",
      );
      expect(result).toEqual({ query: "event:thumbs_up_down" });
    });

    it("refuses a query the language does not parse, with the transform's code", async () => {
      render(<ExplorerLangyActionsMount />);
      await expect(
        call("explorer.setFilter", { query: "status:(" }),
      ).rejects.toMatchObject({ code: "filter_invalid" });
      expect(useExplorerStore.getState().queryText).toBe("");
    });
  });

  describe("when Langy calls explorer.setLens with a lens the page does not hold", () => {
    it("refuses with lens_not_found", async () => {
      render(<ExplorerLangyActionsMount />);
      await expect(
        call("explorer.setLens", { lensId: "no-such-lens" }),
      ).rejects.toMatchObject({ code: "lens_not_found" });
    });
  });

  describe("when Langy calls explorer.getState on a filter with 7 matching traces", () => {
    /** @scenario "explorer.getState answers the live page state" */
    it("answers source live, the query, the window and the count", async () => {
      render(<ExplorerLangyActionsMount />);
      await call("explorer.setFilter", { query: "status:error" });
      settle({ totalHits: 7 });

      const read = (await call("explorer.getState", {})) as {
        source: string;
        query: string;
        totalHits: number | null;
        isCountSettled: boolean;
        timeRange: { presetId?: string };
        pageTraceIds: string[];
      };
      expect(read).toMatchObject({
        source: "live",
        query: "status:error",
        totalHits: 7,
        isCountSettled: true,
        pageTraceIds: ["trace-a", "trace-b"],
      });
      expect(read.timeRange.presetId).toBe("30d");
    });

    it("answers no count rather than the previous search's while the list has not answered", async () => {
      vi.useFakeTimers();
      try {
        render(<ExplorerLangyActionsMount />);
        settle({ totalHits: 99 });
        await call("explorer.setFilter", { query: "status:error" });

        const pending = call("explorer.getState", {});
        await vi.advanceTimersByTimeAsync(7_000);
        const read = (await pending) as {
          totalHits: number | null;
          isCountSettled: boolean;
        };
        expect(read).toMatchObject({ totalHits: null, isCountSettled: false });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when Langy calls explorer.runInstantEval", () => {
    /** @scenario "explorer.runInstantEval starts under the same cost rule as the search bar" */
    it("hands the question, the other chips and the window to the search bar's route", async () => {
      const route = vi.fn();
      const unregister = registerInstantEvalRoute(route);
      try {
        render(<ExplorerLangyActionsMount />);
        await call("explorer.setFilter", { query: "status:error" });
        const { timeRange } = useExplorerStore.getState();

        const result = await call("explorer.runInstantEval", {
          instructions: "Does the user sound annoyed?",
          criteria: ["Complains or repeats a request", "Stays neutral"],
        });

        expect(result).toEqual({ status: "requested", target: "traces" });
        expect(route).toHaveBeenCalledWith({
          projectId: "project-1",
          sentence: "Does the user sound annoyed?",
          question: {
            instructions: "Does the user sound annoyed?",
            criteria: ["Complains or repeats a request", "Stays neutral"],
          },
          target: "traces",
          otherQuery: "status:error",
          fallbackQuery: "status:error",
          timeRange: { from: timeRange.from, to: timeRange.to },
        });
      } finally {
        unregister();
      }
    });

    it("refuses when no search bar is on screen to show the run", async () => {
      render(<ExplorerLangyActionsMount />);
      await expect(
        call("explorer.runInstantEval", {
          instructions: "Annoyed?",
          criteria: ["Complains", "Stays neutral"],
        }),
      ).rejects.toMatchObject({ code: "explorer_search_unavailable" });
    });
  });
});

describe("given a link into the Explorer asks which lens to open", () => {
  /** @scenario "A lens that would change the result set is not kept" */
  it("keeps only a flat lens with no filter of its own", () => {
    expect(lensKeepsTheResultSet({ filterText: "", grouping: "flat" })).toBe(
      true,
    );
    expect(
      lensKeepsTheResultSet({ filterText: "status:error", grouping: "flat" }),
    ).toBe(false);
    expect(
      lensKeepsTheResultSet({ filterText: "", grouping: "by-conversation" }),
    ).toBe(false);
    expect(lensKeepsTheResultSet(undefined)).toBe(false);
  });
});
