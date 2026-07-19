import { describe, expect, it } from "vitest";
import {
  deriveFollowUps,
  followUpsForResult,
  SUGGESTION_LABEL,
  type SettledToolResult,
} from "../components/capabilities/cliFollowUps";
import { FEATURES } from "~/shared/langy/featureMap";

const traceSearch = (
  overrides: Partial<SettledToolResult> = {},
): SettledToolResult => ({
  name: "langwatch.trace.search",
  state: "output-available",
  output: JSON.stringify({
    traces: [{ trace_id: "trace_1" }, { trace_id: "trace_2" }],
    pagination: { totalHits: 2 },
  }),
  ...overrides,
});

const labelsOf = (suggestions: { label: string }[]) =>
  suggestions.map((suggestion) => suggestion.label);

describe("followUpsForResult", () => {
  describe("given a trace search that found traces", () => {
    it("offers every feature that can act on traces", () => {
      const suggestions = followUpsForResult(traceSearch());

      expect(labelsOf(suggestions).sort()).toEqual(
        [
          "Add to a dataset",
          "Alert me on this",
          "Graph these",
          "Send for annotation",
        ].sort(),
      );
    });

    it("names the feature and the kind that justified each offer", () => {
      const dataset = followUpsForResult(traceSearch()).find(
        (suggestion) => suggestion.featureId === "library.datasets",
      );

      expect(dataset).toMatchObject({
        id: "traces:library.datasets",
        featureId: "library.datasets",
        featureName: "Datasets",
        kind: "traces",
        sourceToolName: "langwatch.trace.search",
      });
    });

    it("does not offer to search traces again", () => {
      const suggestions = followUpsForResult(traceSearch());

      expect(
        suggestions.some(
          (suggestion) => suggestion.featureId === "observability.tracing",
        ),
      ).toBe(false);
    });
  });

  describe("given a trace search that matched nothing", () => {
    it("offers nothing to act on", () => {
      const empty = traceSearch({
        output: JSON.stringify({
          traces: [],
          pagination: { totalHits: 0 },
        }),
      });

      expect(followUpsForResult(empty)).toEqual([]);
    });
  });

  describe("given a call that has not settled successfully", () => {
    it("offers nothing while the call is still running", () => {
      expect(
        followUpsForResult(traceSearch({ state: "input-available" })),
      ).toEqual([]);
    });

    it("offers nothing on a failed call", () => {
      expect(
        followUpsForResult(
          traceSearch({ state: "output-error", output: "not found" }),
        ),
      ).toEqual([]);
    });
  });

  describe("given a result from a feature that produces nothing chainable", () => {
    it("offers nothing for a secrets read", () => {
      expect(
        followUpsForResult({
          name: "langwatch.secret.list",
          state: "output-available",
          output: JSON.stringify([{ id: "sec_1" }]),
        }),
      ).toEqual([]);
    });
  });

  describe("given an analytics query that returned metrics", () => {
    it("offers to pin them to a dashboard", () => {
      const suggestions = followUpsForResult({
        name: "langwatch.analytics.query",
        state: "output-available",
        output: JSON.stringify({
          data: [{ metric: "trace_count", value: 12 }],
        }),
      });

      expect(labelsOf(suggestions)).toEqual(["Pin to a dashboard"]);
    });
  });

  describe("given a tool call that is not a LangWatch CLI call", () => {
    it("offers nothing for a raw shell call", () => {
      expect(
        followUpsForResult({
          name: "bash",
          state: "output-available",
          output: "ok",
        }),
      ).toEqual([]);
    });
  });
});

describe("deriveFollowUps", () => {
  describe("given a turn with several tool calls", () => {
    it("offers each follow-up once, in first-seen order", () => {
      const suggestions = deriveFollowUps({
        results: [
          traceSearch(),
          traceSearch({ name: "langwatch.trace.export" }),
        ],
      });

      const ids = suggestions.map((suggestion) => suggestion.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(labelsOf(suggestions)).toContain("Add to a dataset");
    });
  });

  describe("given a turn whose calls produced nothing", () => {
    it("offers nothing rather than an empty row of chips", () => {
      expect(
        deriveFollowUps({
          results: [
            { name: "bash", state: "output-available", output: "ok" },
            traceSearch({ output: JSON.stringify({ traces: [] }) }),
          ],
        }),
      ).toEqual([]);
    });
  });
});

describe("the suggestion copy, given feature-map.json is the source of structure", () => {
  describe("when a feature is worded for an offer", () => {
    it("words only features the map actually declares", () => {
      const featureIds = new Set(FEATURES.map((feature) => feature.id));
      const unknown = Object.keys(SUGGESTION_LABEL).filter(
        (id) => !featureIds.has(id),
      );

      expect(unknown).toEqual([]);
    });

    it("words only features that consume something", () => {
      const consumers = new Set(
        FEATURES.filter((feature) => feature.consumes.length > 0).map(
          (feature) => feature.id,
        ),
      );
      const orphaned = Object.keys(SUGGESTION_LABEL).filter(
        (id) => !consumers.has(id),
      );

      expect(orphaned).toEqual([]);
    });
  });
});
