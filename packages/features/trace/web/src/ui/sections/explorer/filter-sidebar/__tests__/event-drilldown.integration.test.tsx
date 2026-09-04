/**
 * @vitest-environment jsdom
 *
 * Coverage for the event drilldown (specs/traces-v2/search.feature, Rule
 * "Event rows drill down into their metric values"):
 * - metric values render from the discover payload (`item.eventMetrics`)
 *   with their counts — the component fires no query of its own;
 * - metric-group headers strip the `event.metrics.` storage prefix for
 *   display while clicks keep the full key;
 * - clicking a value on an ALREADY-ACTIVE event row emits exactly one
 *   top-level `event.attribute.event.metrics.<key>` toggle — never a group
 *   mutation (the cross-event AND collision, once two different events are
 *   both active, is a documented, accepted limitation);
 * - clicking a value on an INACTIVE event row adds the `event:<type>`
 *   anchor first, so the metric clause never lands unscoped;
 * - a predefined event's opaque codes read as words ("-1" shows as "thumbs
 *   down") while the click still emits the stored string; every metric
 *   without a human name shows exactly what ingest wrote;
 * - an event carrying no metrics renders nothing to expand into;
 * - active values read their include/exclude state from the AST;
 * - driven against the real filter store, one click yields
 *   "event:x AND event.attribute...:v" and cycling the value back off leaves
 *   the bare "event:x" anchor behind (the accepted limitation).
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { EMPTY_AST, parse } from "@langwatch/trace-contract";
import { useFilterStore } from "../../../../../behavior/filter.store";
import { EventDrilldown } from "../event-drilldown";
import type { FacetItem } from "../../../../../behavior/explorer/filter-sidebar/types";

const buildItem = ({
  eventMetrics = [
    {
      key: "event.metrics.vote",
      values: [
        { value: "1", count: 12 },
        { value: "-1", count: 3 },
      ],
    },
  ],
}: {
  eventMetrics?: FacetItem["eventMetrics"];
} = {}): FacetItem => ({
  value: "thumbs_up_down",
  label: "thumbs_up_down",
  count: 15,
  eventMetrics,
});

const renderDrilldown = ({
  item = buildItem(),
  ast = EMPTY_AST,
  toggleFacet = vi.fn(),
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <EventDrilldown item={item} ast={ast} toggleFacet={toggleFacet} />
    </ChakraProvider>,
  );
  return { toggleFacet };
};

afterEach(cleanup);

describe("EventDrilldown", () => {
  describe("given a thumbs_up_down item with vote metrics from the discover payload", () => {
    /** @scenario "Expanding the thumbs_up_down row shows its vote values with counts" */
    it("names each vote in words, with its count", () => {
      renderDrilldown();

      expect(screen.getByText("thumbs up")).toBeInTheDocument();
      expect(screen.getByText("thumbs down")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.queryByText("-1")).not.toBeInTheDocument();
    });

    it("strips the event.metrics. prefix from the group header only", () => {
      renderDrilldown();

      expect(screen.getByText("vote")).toBeInTheDocument();
      expect(screen.queryByText("event.metrics.vote")).not.toBeInTheDocument();
    });

    describe("when the row is already an active filter and the user clicks a metric value", () => {
      /** @scenario "Clicking a vote value on an already-active event row applies a single event-attribute filter" */
      it("toggles a single top-level event.attribute field with the verbatim value", () => {
        const { toggleFacet } = renderDrilldown({
          ast: parse("event:thumbs_up_down"),
        });

        // Reads "thumbs down", filters on the stored "-1".
        fireEvent.click(screen.getByText("thumbs down"));

        expect(toggleFacet).toHaveBeenCalledTimes(1);
        expect(toggleFacet).toHaveBeenCalledWith({
          field: "event.attribute.event.metrics.vote",
          value: "-1",
        });
      });
    });

    describe("when the row is NOT yet an active filter and the user clicks a metric value", () => {
      /** @scenario "Clicking a vote value on an inactive event row scopes the filter to that event first" */
      it("adds the event anchor before the metric clause", () => {
        const { toggleFacet } = renderDrilldown({ ast: EMPTY_AST });

        fireEvent.click(screen.getByText("thumbs down"));

        expect(toggleFacet).toHaveBeenCalledTimes(2);
        expect(toggleFacet).toHaveBeenNthCalledWith(1, {
          field: "event",
          value: "thumbs_up_down",
        });
        expect(toggleFacet).toHaveBeenNthCalledWith(2, {
          field: "event.attribute.event.metrics.vote",
          value: "-1",
        });
      });
    });

    describe("when a vote value is already active in the query", () => {
      it("marks that row as included", () => {
        renderDrilldown({
          ast: parse("event.attribute.event.metrics.vote:-1"),
        });

        expect(
          screen.getByRole("button", { name: /thumbs down/ }),
        ).toHaveAttribute("data-state", "include");
      });

      it("names the row included, distinctly from an excluded one", () => {
        renderDrilldown({
          ast: parse("event.attribute.event.metrics.vote:-1"),
        });

        expect(
          screen.getByRole("button", { name: "vote thumbs down — included" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", {
            name: "vote thumbs up — click to filter",
          }),
        ).toBeInTheDocument();
      });
    });

    describe("when a vote value is excluded in the query", () => {
      it("names the row excluded rather than merely active", () => {
        renderDrilldown({
          ast: parse("NOT event.attribute.event.metrics.vote:-1"),
        });

        expect(
          screen.getByRole("button", { name: "vote thumbs down — excluded" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given two metric groups that share a stored value", () => {
    describe("when the drilldown renders", () => {
      it("qualifies each value with its metric key so the names stay distinct", () => {
        renderDrilldown({
          item: buildItem({
            eventMetrics: [
              {
                key: "event.metrics.rating",
                values: [{ value: "1", count: 2 }],
              },
              {
                key: "event.metrics.stars",
                values: [{ value: "1", count: 4 }],
              },
            ],
          }),
        });

        expect(
          screen.getByRole("button", { name: "rating 1 — click to filter" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "stars 1 — click to filter" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given an event type carrying no metrics", () => {
    describe("when the drilldown renders", () => {
      /** @scenario "An event type with no metrics shows no drilldown affordance" */
      it("renders nothing to expand into", () => {
        // Two shapes reach here. The server omits `eventMetrics` entirely for
        // an event with no `event.metrics.*` attributes, which is what
        // suppresses the chevron in SectionRenderer. The empty array is the
        // shape no endpoint currently emits — guarded anyway so a future
        // payload change cannot produce a chevron expanding into a blank strip.
        for (const eventMetrics of [undefined, []]) {
          const { container, unmount } = render(
            <ChakraProvider value={defaultSystem}>
              <EventDrilldown
                item={{
                  value: "custom_marker",
                  label: "custom_marker",
                  count: 3,
                  eventMetrics,
                }}
                ast={EMPTY_AST}
                toggleFacet={vi.fn()}
              />
            </ChakraProvider>,
          );

          expect(container).toBeEmptyDOMElement();
          unmount();
        }
      });
    });
  });

  describe("given an event whose metric has no human name", () => {
    describe("when the drilldown renders", () => {
      /** @scenario "A metric with no human name shows its stored value" */
      it("shows the stored value", () => {
        // Metric values are numbers on every path — `eventSchema.metrics` is a
        // record of string to number — so the unlabelled case is a decimal,
        // not some free-form string. Ingest rejects a string with a 400.
        renderDrilldown({
          item: {
            value: "checkout_survey",
            label: "checkout_survey",
            count: 1,
            eventMetrics: [
              {
                key: "event.metrics.stars",
                values: [{ value: "4", count: 1 }],
              },
            ],
          },
        });

        expect(screen.getByText("4")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "stars 4 — click to filter" }),
        ).toBeInTheDocument();
      });
    });
  });

  /**
   * Every case above hands `toggleFacet` a `vi.fn()` and asserts the
   * arguments, which proves what the component ASKS for but never what the
   * query BECOMES. These two drive the real store, so the assertion is the
   * text a user would read in the search bar.
   */
  describe("given the drilldown drives the real filter store", () => {
    const renderAgainstStore = () => {
      useFilterStore.getState().applyQueryText("");
      const item = buildItem();
      const toggleFacet = ({
        field,
        value,
      }: {
        field: string;
        value: string;
      }) => useFilterStore.getState().toggleFacet(field, value);
      const tree = () => (
        <ChakraProvider value={defaultSystem}>
          <EventDrilldown
            item={item}
            ast={useFilterStore.getState().ast}
            toggleFacet={toggleFacet}
          />
        </ChakraProvider>
      );
      const view = render(tree());
      // `eventActive` is derived from the `ast` PROP, so the component has to
      // be handed the store's new AST after each click the way the sidebar
      // does when it re-renders.
      const clickThumbsDown = () => {
        fireEvent.click(
          screen.getByRole("button", { name: /^vote thumbs down/ }),
        );
        view.rerender(tree());
      };
      return { clickThumbsDown };
    };

    describe("when the user clicks a vote value on an inactive row", () => {
      /** @scenario "Clicking a vote value on an inactive event row scopes the filter to that event first" */
      it("writes the anchor and the metric clause as one AND query", () => {
        const { clickThumbsDown } = renderAgainstStore();
        clickThumbsDown();
        expect(useFilterStore.getState().queryText).toBe(
          "event:thumbs_up_down AND event.attribute.event.metrics.vote:-1",
        );
      });
    });

    describe("when the user cycles that same value back off", () => {
      /** @scenario "Clearing the metric leaves the event anchor it added behind" */
      it("drops the metric clause and leaves the anchor it added behind", () => {
        const { clickThumbsDown } = renderAgainstStore();
        clickThumbsDown(); // neutral -> include
        clickThumbsDown(); // include -> exclude
        clickThumbsDown(); // exclude -> neutral
        expect(useFilterStore.getState().queryText).toBe(
          "event:thumbs_up_down",
        );
      });
    });
  });
});
