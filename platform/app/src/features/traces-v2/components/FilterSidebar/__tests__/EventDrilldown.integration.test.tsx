/**
 * @vitest-environment jsdom
 *
 * Coverage for the event drilldown (specs/traces-v2/search.feature, Rule
 * "Event rows drill down into their metric values"):
 * - metric values render from the discover payload (`item.eventMetrics`)
 *   with their counts — the component fires no query of its own;
 * - metric-group headers strip the `event.metrics.` storage prefix for
 *   display while clicks keep the full key;
 * - clicking a value emits exactly one top-level
 *   `event.attribute.event.metrics.<key>` toggle — never a group mutation
 *   (the cross-event AND collision is a documented, accepted limitation);
 * - values are rendered verbatim as stored ("1", "-1"), never reformatted;
 * - active values read their include/exclude state from the AST.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  EMPTY_AST,
  parse,
} from "~/server/app-layer/traces/query-language/parse";
import { EventDrilldown } from "../EventDrilldown";
import type { FacetItem } from "../types";

const buildItem = (
  eventMetrics: FacetItem["eventMetrics"] = [
    {
      key: "event.metrics.vote",
      values: [
        { value: "1", count: 12 },
        { value: "-1", count: 3 },
      ],
    },
  ],
): FacetItem => ({
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
      // The bare codes never reach the user.
      expect(screen.queryByText("-1")).not.toBeInTheDocument();
    });

    it("strips the event.metrics. prefix from the group header only", () => {
      renderDrilldown();

      expect(screen.getByText("vote")).toBeInTheDocument();
      expect(screen.queryByText("event.metrics.vote")).not.toBeInTheDocument();
    });

    describe("when the user clicks a metric value", () => {
      /** @scenario "Clicking a vote value applies a single event-attribute filter" */
      it("toggles a single top-level event.attribute field with the verbatim value", () => {
        const { toggleFacet } = renderDrilldown();

        // Reads "thumbs down", filters on the stored "-1".
        fireEvent.click(screen.getByText("thumbs down"));

        expect(toggleFacet).toHaveBeenCalledTimes(1);
        expect(toggleFacet).toHaveBeenCalledWith({
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
    it("qualifies each value with its metric key so the names stay distinct", () => {
      renderDrilldown({
        item: buildItem([
          { key: "event.metrics.rating", values: [{ value: "1", count: 2 }] },
          { key: "event.metrics.stars", values: [{ value: "1", count: 4 }] },
        ]),
      });

      expect(
        screen.getByRole("button", { name: "rating 1 — click to filter" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "stars 1 — click to filter" }),
      ).toBeInTheDocument();
    });
  });

  describe("given an event whose metric has no human name", () => {
    /** @scenario "A metric with no human name shows its stored value" */
    it("shows the stored value", () => {
      // Metric values are numbers on every path — `eventSchema.metrics` is a
      // record of string to number — so the unlabelled case is a decimal, not
      // some free-form string. Ingest rejects a string with a 400.
      renderDrilldown({
        item: {
          value: "checkout_survey",
          label: "checkout_survey",
          count: 1,
          eventMetrics: [
            { key: "event.metrics.stars", values: [{ value: "4", count: 1 }] },
          ],
        },
      });

      expect(
        screen.getByRole("button", { name: "stars 4 — click to filter" }),
      ).toBeInTheDocument();
    });
  });
});
