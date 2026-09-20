/**
 * The away half of the Explorer's actions: with no page open, a search action
 * answers a link, a read answers the saved defaults, and an action that needs
 * a page is refused.
 *
 * Spec: specs/langy/langy-trace-explorer-actions.feature ("With no Explorer
 * open, a search action answers a link").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EXPLORER_ACTIONS } from "~/features/traces-v2/actions/manifest";
import type { ExperimentService } from "~/server/experiments/experiment.service";
import { findPageAction } from "../pageManifests";
import { executeBackendAction } from "../uiActionBackendExecutor";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

// The Explorer's away form touches no experiment, so a service that throws on
// any use proves it is never reached.
const experiments = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("the Explorer's away form never reads an experiment");
    },
  },
) as ExperimentService;

const CONTEXT = {
  projectId: "project-1",
  projectSlug: "acme",
  userId: "user-1",
};

function run(kind: keyof typeof EXPLORER_ACTIONS, payload: unknown) {
  const definition = findPageAction(kind);
  if (!definition) throw new Error(`${kind} is not registered`);
  return executeBackendAction({
    experiments,
    context: CONTEXT,
    kind,
    definition,
    payload: definition.payloadSchema.parse(payload),
  });
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
    it("answers a labelled link to the Explorer with that query", async () => {
      const result = (await run("explorer.setFilter", {
        query: "status:error",
      })) as { query: string; href: string; label: string };

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
    it("answers a link carrying the preset", async () => {
      const result = (await run("explorer.setTimeRange", {
        preset: "7d",
      })) as { href: string; presetId: string };

      expect(result.presetId).toBe("7d");
      expect(fragmentOf(result.href).params.get("preset")).toBe("7d");
    });
  });

  describe("when explorer.setLens runs on the backend", () => {
    it("answers a link to that lens, for the page to install on arrival", async () => {
      const result = (await run("explorer.setLens", {
        lensId: "conversations",
      })) as { href: string };
      expect(result.href).toBe("/acme/traces#conversations");
    });
  });

  describe("when explorer.getState runs on the backend", () => {
    /** @scenario "With no Explorer open getState answers the saved defaults" */
    it("says source saved, the default lens and window, and no count", async () => {
      const result = (await run("explorer.getState", {})) as {
        source: string;
        lens: { id: string };
        timeRange: { presetId: string; to: number };
        totalHits: number | null;
        href: string;
      };
      expect(result.source).toBe("saved");
      expect(result.note).toContain("not what is on the user's screen");
      expect(result.totalHits).toBeNull();
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
    ] as const)("refuses %s with langy_ui_no_browser", async (kind, payload) => {
      await expect(run(kind, payload)).rejects.toMatchObject({
        code: "langy_ui_no_browser",
      });
    });
  });

  describe("when explorer.setFilter runs on the backend with a query that does not parse", () => {
    /** @scenario "A filter the language refuses is refused on the backend too" */
    it("answers langy_ui_handler_failed naming filter_invalid", async () => {
      await expect(
        run("explorer.setFilter", { query: "status:(" }),
      ).rejects.toMatchObject({
        code: "langy_ui_handler_failed",
        meta: { kind: "explorer.setFilter", errorCode: "filter_invalid" },
      });
    });
  });
});
