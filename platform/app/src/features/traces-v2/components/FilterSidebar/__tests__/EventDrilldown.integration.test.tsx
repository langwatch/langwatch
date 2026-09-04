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
    it("renders each stored value verbatim with its count", () => {
      renderDrilldown();

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("-1")).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
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

        fireEvent.click(screen.getByText("-1"));

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

        expect(screen.getByRole("button", { name: /-1/ })).toHaveAttribute(
          "data-state",
          "include",
        );
      });

      it("names the row included, distinctly from an excluded one", () => {
        renderDrilldown({
          ast: parse("event.attribute.event.metrics.vote:-1"),
        });

        expect(
          screen.getByRole("button", { name: "vote -1 — included" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "vote 1 — click to filter" }),
        ).toBeInTheDocument();
      });
    });

    describe("when a vote value is excluded in the query", () => {
      it("names the row excluded rather than merely active", () => {
        renderDrilldown({
          ast: parse("NOT event.attribute.event.metrics.vote:-1"),
        });

        expect(
          screen.getByRole("button", { name: "vote -1 — excluded" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given two metric groups that share a value", () => {
    it("qualifies each value with its metric key so the names stay distinct", () => {
      renderDrilldown({
        item: buildItem([
          { key: "event.metrics.vote", values: [{ value: "1", count: 4 }] },
          { key: "event.metrics.rating", values: [{ value: "1", count: 2 }] },
        ]),
      });

      expect(
        screen.getByRole("button", { name: "vote 1 — click to filter" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "rating 1 — click to filter" }),
      ).toBeInTheDocument();
    });
  });
});
