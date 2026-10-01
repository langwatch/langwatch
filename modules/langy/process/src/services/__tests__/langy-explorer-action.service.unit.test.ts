/**
 * The away half of the Explorer's actions: with no page open, a search action
 * answers a link, a read answers the saved defaults, and an action that needs
 * a page is refused. Spec: specs/langy/langy-trace-explorer-actions.feature.
 */
import { EXPLORER_ACTIONS, type ExplorerActionKind } from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangyExplorerActionService } from "../langy-explorer-action.service.ts";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

const service = LangyExplorerActionService.create();

function run(kind: ExplorerActionKind, payload: unknown) {
  const parsed = EXPLORER_ACTIONS[kind].payloadSchema.parse(payload);
  return service.run({ projectSlug: "acme", kind, payload: parsed });
}

function fragmentOf(href: string): { lens: string; params: URLSearchParams } {
  const fragment = href.slice(href.indexOf("#") + 1);
  const [lens, query] = fragment.split("?", 2);
  return { lens: lens ?? "", params: new URLSearchParams(query ?? "") };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("given no page claims an explorer action", () => {
  describe("when explorer.setFilter runs on the backend", () => {
    /** @scenario "With no Explorer open a filter action answers a link to the Explorer" */
    it("answers a labelled link to the Explorer with that query", () => {
      const result = run("explorer.setFilter", { query: "status:error" }) as {
        query: string;
        href: string;
        label: string;
      };

      expect(result.query).toBe("status:error");
      expect(result.label).toBe("View in Trace Explorer");
      expect(result.href.startsWith("/acme/traces#")).toBe(true);
      const { lens, params } = fragmentOf(result.href);
      expect(lens).toBe("all-traces");
      expect(params.get("q")).toBe("status:error");
    });
  });

  describe("when explorer.setTimeRange runs on the backend with a preset", () => {
    /** @scenario "With no Explorer open a time range action answers a link with that window" */
    it("answers a link carrying the preset", () => {
      const result = run("explorer.setTimeRange", { preset: "7d" }) as {
        href: string;
        presetId: string;
      };

      expect(result.presetId).toBe("7d");
      expect(fragmentOf(result.href).params.get("preset")).toBe("7d");
    });
  });

  describe("when explorer.setLens runs on the backend", () => {
    it("answers a link to that lens, for the page to install on arrival", () => {
      const result = run("explorer.setLens", { lensId: "conversations" }) as {
        href: string;
      };
      expect(result.href).toBe("/acme/traces#conversations");
    });
  });

  describe("when explorer.getState runs on the backend", () => {
    /** @scenario "With no Explorer open getState answers the saved defaults" */
    it("says source saved, the default lens and window, and no count", () => {
      const result = run("explorer.getState", {}) as {
        source: string;
        note: string;
        lens: { id: string };
        timeRange: { presetId: string; to: number };
        totalHits: number | null;
        href: string;
      };
      expect(result.source).toBe("saved");
      expect(result.note).toContain("not what is on the user's screen");
      expect(result.lens.id).toBe("all-traces");
      expect(result.timeRange.presetId).toBe("30d");
      expect(result.timeRange.to).toBe(NOW);
      expect(result.totalHits).toBeNull();
      expect(result.href).toBe("/acme/traces#all-traces");
    });
  });

  describe("when an action that needs an open page runs on the backend", () => {
    /** @scenario "An action that needs an open page is refused without one" */
    it.each([
      ["explorer.select", { traceIds: ["trace-a"] }],
      ["explorer.setPage", { page: 2 }],
      ["explorer.setSort", { columnId: "cost" }],
      [
        "explorer.runInstantEval",
        { instructions: "Annoyed?", criteria: ["Complains", "Stays neutral"] },
      ],
    ] as const)("refuses %s with langy_ui_no_browser", (kind, payload) => {
      expect(() => run(kind, payload)).toThrowError(
        expect.objectContaining({ code: "langy_ui_no_browser" }),
      );
    });
  });

  describe("when explorer.setFilter runs on the backend with a query that does not parse", () => {
    /** @scenario "A filter the language refuses is refused on the backend too" */
    it("answers langy_ui_handler_failed naming filter_invalid", () => {
      expect(() => run("explorer.setFilter", { query: "status:(" })).toThrowError(
        expect.objectContaining({
          code: "langy_ui_handler_failed",
          meta: expect.objectContaining({
            kind: "explorer.setFilter",
            errorCode: "filter_invalid",
          }),
        }),
      );
    });
  });
});
