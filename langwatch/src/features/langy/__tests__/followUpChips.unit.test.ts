import { describe, expect, it } from "vitest";
import {
  deriveFollowUpChips,
  type SettledCall,
} from "../components/capabilities/followUpChips";

/** A settled trace search carrying a structured error filter over the last day. */
const traceSearch = (over: Partial<SettledCall> = {}): SettledCall => ({
  name: "langwatch.trace.search",
  state: "output-available",
  input: { filters: { "traces.error": ["true"] }, startDate: "24h" },
  output: JSON.stringify({
    traces: [{ trace_id: "trace_1" }],
    pagination: { totalHits: 1 },
  }),
  ...over,
});

const labelsOf = (chips: { label: string }[]) => chips.map((c) => c.label);

describe("deriveFollowUpChips", () => {
  describe("given a trace search that found traces", () => {
    describe("when the search filtered on errors", () => {
      it("offers to graph the search, carrying the error filter across", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: "demo",
        });

        expect(chips).toContainEqual({
          id: "traces:observability.analytics",
          label: "Graph these",
          href: "/demo/analytics/custom?has_error=true",
        });
      });

      it("offers to alert on the search, carrying the error filter across", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: "demo",
        });

        expect(chips).toContainEqual({
          id: "traces:triggers",
          label: "Alert me on this",
          href: "/demo/messages?has_error=true&drawer.open=automation",
        });
      });

      it("drops the offers no destination can carry (dataset, annotation)", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: "demo",
        });

        expect(labelsOf(chips)).toEqual(["Graph these", "Alert me on this"]);
      });
    });

    describe("when the search had only free text, nothing a field filter", () => {
      it("offers nothing — a graph and an alert need fields, not free text", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch({ input: { query: "refund policy" } }),
          projectSlug: "demo",
        });

        expect(chips).toEqual([]);
      });
    });

    describe("when there is no project to build a link from", () => {
      it("offers nothing rather than a dead link", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: null,
        });

        expect(chips).toEqual([]);
      });
    });
  });

  describe("given a search that matched nothing", () => {
    it("offers nothing — there is no 'these' to act on", () => {
      const chips = deriveFollowUpChips({
        call: traceSearch({
          output: JSON.stringify({ traces: [], pagination: { totalHits: 0 } }),
        }),
        projectSlug: "demo",
      });

      expect(chips).toEqual([]);
    });
  });

  describe("given a call that has not settled successfully", () => {
    it("offers nothing while the call is still running", () => {
      expect(
        deriveFollowUpChips({
          call: traceSearch({ state: "input-available" }),
          projectSlug: "demo",
        }),
      ).toEqual([]);
    });

    it("offers nothing on a failed call", () => {
      expect(
        deriveFollowUpChips({
          call: traceSearch({ state: "output-error", output: "not found" }),
          projectSlug: "demo",
        }),
      ).toEqual([]);
    });
  });

  describe("given an analytics result whose only offer has no destination", () => {
    it("drops 'Pin to a dashboard' — no dashboard preload link exists yet", () => {
      const chips = deriveFollowUpChips({
        call: {
          name: "langwatch.analytics.query",
          state: "output-available",
          input: {},
          output: JSON.stringify({ data: [{ metric: "trace_count", value: 9 }] }),
        },
        projectSlug: "demo",
      });

      expect(chips).toEqual([]);
    });
  });
});
