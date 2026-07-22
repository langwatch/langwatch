import { describe, expect, it } from "vitest";
import {
  deriveFollowUpChips,
  MAX_FOLLOW_UP_CHIPS,
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
          carried: true,
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
          carried: true,
        });
      });

      it("puts the chips that carry the filter before the ones that only navigate", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: "demo",
        });

        const firstPlain = chips.findIndex((chip) => !chip.carried);
        const lastCarried = chips.map((c) => c.carried).lastIndexOf(true);
        if (firstPlain !== -1) expect(lastCarried).toBeLessThan(firstPlain);
      });

      it("keeps the row a next step, not a menu", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch(),
          projectSlug: "demo",
        });

        expect(chips.length).toBeLessThanOrEqual(MAX_FOLLOW_UP_CHIPS);
      });
    });

    describe("when the search had only free text, nothing a field filter", () => {
      it("cannot carry the filter, so it offers the surfaces instead", () => {
        // A graph and an alert need FIELDS, so nothing can be recompiled here.
        // That used to mean silence; now the offers still resolve, worded so
        // they never claim the search came along.
        const chips = deriveFollowUpChips({
          call: traceSearch({ input: { query: "refund policy" } }),
          projectSlug: "demo",
        });

        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every((chip) => !chip.carried)).toBe(true);
        expect(
          chips.every((chip) => chip.label.startsWith("Open in ")),
        ).toBe(true);
      });
    });

    describe("when the search arrived through the CLI envelope", () => {
      /**
       * The live transport: opencode ran the CLI through `bash`, and the
       * envelope retyped the call to `langwatch.trace.search` while keeping
       * the shell payload as its input. The CLI's `trace search` has no
       * field-filter flags at all (`--query/--start-date/--end-date/--limit`
       * only), so nothing can be recompiled into the graph or the alert —
       * every offer must resolve at the plain grade, as real links to real
       * surfaces, never as silence and never as a carried label that lies.
       */
      it("offers the surfaces as plain chips with real destinations", () => {
        const chips = deriveFollowUpChips({
          call: traceSearch({
            input: {
              command:
                "langwatch trace search --query 'checkout failed' --limit 25",
            },
          }),
          projectSlug: "demo",
        });

        expect(chips).toEqual([
          {
            id: "traces:observability.analytics",
            label: "Open in Analytics",
            href: "/demo/analytics",
            carried: false,
          },
          {
            id: "traces:observability.annotations",
            label: "Open in Annotations",
            href: "/demo/annotations",
            carried: false,
          },
          {
            id: "traces:library.datasets",
            label: "Open in Datasets",
            href: "/demo/datasets",
            carried: false,
          },
        ]);
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

  describe("given a result that is not a trace search", () => {
    /**
     * The regression this exists to prevent. `deriveFollowUpChips` used to bail
     * unless the input parsed as a TRACE query, so an analytics answer — the
     * single most likely thing a user asks a follow-up about — earned no
     * guidance whatsoever, even though the feature map had already derived the
     * offer.
     */
    it("still guides the user somewhere, rather than offering nothing at all", () => {
      const chips = deriveFollowUpChips({
        call: {
          name: "langwatch.analytics.query",
          state: "output-available",
          input: {},
          output: JSON.stringify({
            data: [{ metric: "trace_count", value: 9 }],
          }),
        },
        projectSlug: "demo",
      });

      expect(chips.length).toBeGreaterThan(0);
      // Nothing was recompiled, so nothing may claim to have been.
      expect(chips.every((chip) => !chip.carried)).toBe(true);
      expect(chips.every((chip) => chip.href.startsWith("/demo/"))).toBe(true);
    });
  });
});
