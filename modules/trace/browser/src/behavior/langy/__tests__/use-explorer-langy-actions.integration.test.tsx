import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
// The Explorer's side of the UI-action channel, run against the real store.
// Spec: specs/langy/langy-trace-explorer-actions.feature
import { useExplorerStore } from "../../explorer.store.ts";
import { registerInstantEvalRoute } from "../instant-eval-route.bridge.ts";
import {
  type ExplorerLangyActionHandlers,
  useExplorerLangyActions,
} from "../use-explorer-langy-actions.ts";

function handlers(): ExplorerLangyActionHandlers {
  return renderHook(() => useExplorerLangyActions()).result.current;
}

vi.mock("../../trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOptionalTraceHost: () => ({ project: () => ({ id: "project-1" }) }),
}));

/** Runs one handler the way the agent's executor does: schema first. */
async function call(kind: string, payload: unknown): Promise<unknown> {
  const handler = handlers()[kind];
  if (!handler) throw new Error(`no handler for ${kind}`);
  return handler.run(handler.payloadSchema.parse(payload) as never);
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
  const store = useExplorerStore.getState();
  store.selectLens("all-traces", { persist: false });
  store.clearAll();
  store.clearSelection();
  store.commitDebounced();
});

describe("given the Trace Explorer is open", () => {
  describe("when Langy calls explorer.setFilter", () => {
    /** @scenario "explorer.setFilter applies the filter on screen and answers what was applied" */
    it("puts the query in the store the search bar reads and answers it", async () => {
      const result = await call("explorer.setFilter", { query: "event:thumbs_up_down" });

      expect(useExplorerStore.getState().queryText).toBe("event:thumbs_up_down");
      expect(result).toEqual({ query: "event:thumbs_up_down" });
    });

    it("refuses a query the language does not parse, with the transform's code", async () => {
      await expect(call("explorer.setFilter", { query: "status:(" })).rejects.toMatchObject({
        code: "filter_invalid",
      });
      expect(useExplorerStore.getState().queryText).toBe("");
    });
  });

  describe("when Langy calls explorer.setLens with a lens the page does not hold", () => {
    it("refuses with lens_not_found", async () => {
      await expect(call("explorer.setLens", { lensId: "no-such-lens" })).rejects.toMatchObject({
        code: "lens_not_found",
      });
    });
  });

  describe("when Langy calls explorer.getState on a filter with 7 matching traces", () => {
    /** @scenario "explorer.getState answers the live page state" */
    it("answers source live, the query, the window and the count", async () => {
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
        settle({ totalHits: 99 });
        await call("explorer.setFilter", { query: "status:error" });

        const pending = call("explorer.getState", {});
        await vi.advanceTimersByTimeAsync(7_000);
        const read = (await pending) as { totalHits: number | null; isCountSettled: boolean };

        expect(read).toMatchObject({ totalHits: null, isCountSettled: false });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("given the Trace Explorer is open and Langy asks an Instant Eval question", () => {
  describe("when the search bar's route is mounted", () => {
    /** @scenario "explorer.runInstantEval starts under the same cost rule as the search bar" */
    it("hands the question, the other chips and the window to that route", async () => {
      const route = vi.fn();
      const unregister = registerInstantEvalRoute(route);
      try {
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
  });

  describe("when no search bar is on screen", () => {
    it("refuses with explorer_search_unavailable", async () => {
      await expect(
        call("explorer.runInstantEval", {
          instructions: "Annoyed?",
          criteria: ["Complains", "Stays neutral"],
        }),
      ).rejects.toMatchObject({ code: "explorer_search_unavailable" });
    });
  });
});
