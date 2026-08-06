/**
 * @vitest-environment jsdom
 *
 * The Events column. A trace's events are OTel span events read back from
 * `stored_spans` per page, and a row collapses them by name: an agent turn
 * that retried a tool 237 times is one badge, not 237.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  TraceListEventGroup,
  TraceListItem,
} from "../../../../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../../../../types/trace";
import { EventsCell } from "../EventsCell";

afterEach(cleanup);

function group(
  name: string,
  count = 1,
  firstTimestamp = 0,
): TraceListEventGroup {
  return { name, count, firstTimestamp };
}

function row(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 0,
    name: "trace",
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  } as unknown as TraceListItem;
}

function renderCell(item: TraceListItem) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {EventsCell.render({ row: item } as never)}
    </ChakraProvider>,
  );
}

describe("EventsCell", () => {
  describe("given a trace that recorded events", () => {
    /** @scenario A trace with events shows a badge per event name */
    it("shows a badge naming the event", () => {
      renderCell(
        row({
          events: {
            groups: [group("thumbs_up_down")],
            totalCount: 1,
            distinctCount: 1,
          },
        }),
      );

      expect(screen.getByText("thumbs_up_down")).toBeInTheDocument();
    });

    /** @scenario Repeated events of the same name collapse into one badge with a count */
    it("carries the repeat count on the badge instead of repeating it", () => {
      renderCell(
        row({
          events: {
            groups: [group("tool.output", 237), group("first_token", 1)],
            totalCount: 238,
            distinctCount: 2,
          },
        }),
      );

      expect(screen.getByText("tool.output")).toBeInTheDocument();
      expect(screen.getByText("237")).toBeInTheDocument();
      // A single occurrence needs no count — "first_token 1" reads as noise.
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });

    /** @scenario Overflowing badges collapse into a remainder chip */
    it("shows the first three names and collapses the rest into a remainder chip", () => {
      const names = ["a.one", "b.two", "c.three", "d.four", "e.five"];
      renderCell(
        row({
          events: {
            groups: names.map((name, i) => group(name, 1, i)),
            totalCount: 5,
            distinctCount: 5,
          },
        }),
      );

      expect(screen.getByText("a.one")).toBeInTheDocument();
      expect(screen.getByText("c.three")).toBeInTheDocument();
      expect(screen.queryByText("d.four")).not.toBeInTheDocument();
      expect(screen.getByText("+2")).toBeInTheDocument();
    });

    /** @scenario Overflowing badges collapse into a remainder chip */
    it("names the collapsed events on the remainder chip", () => {
      const names = ["a.one", "b.two", "c.three", "d.four", "e.five"];
      renderCell(
        row({
          events: {
            groups: names.map((name, i) => group(name, 1, i)),
            totalCount: 5,
            distinctCount: 5,
          },
        }),
      );

      expect(screen.getByText("+2")).toHaveAttribute("title", "d.four, e.five");
    });

    /** @scenario A trace with a very large number of events stays bounded */
    it("counts the names trimmed off the rollup into the remainder", () => {
      renderCell(
        row({
          events: {
            // The read returned 4 of the trace's 40 distinct names.
            groups: ["a", "b", "c", "d"].map((name, i) => group(name, 1, i)),
            totalCount: 100,
            distinctCount: 40,
          },
        }),
      );

      expect(screen.getByText("+37")).toBeInTheDocument();
      expect(screen.getByText("+37")).toHaveAttribute(
        "title",
        "d, and 36 more",
      );
    });
  });

  describe("given a trace that recorded no events", () => {
    /** @scenario A trace with no events shows the empty marker */
    it("shows the empty marker", () => {
      renderCell(row({ events: NO_TRACE_EVENTS }));
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("when the page's events are still loading", () => {
    /** @scenario The list still renders while events are in flight */
    it("holds the space rather than claiming the trace recorded nothing", () => {
      const { container } = renderCell(
        row({ events: NO_TRACE_EVENTS, eventsLoading: true }),
      );

      expect(screen.queryByText("—")).not.toBeInTheDocument();
      expect(container.firstChild).toBeTruthy();
    });
  });
});
