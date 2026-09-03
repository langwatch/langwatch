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
import type { TraceListEventGroup, TraceListItem } from "../../../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../../../types/trace";
import { EventsCell } from "../events-cell";

afterEach(cleanup);

/** One event name and how often the trace recorded it, as the read returns it. */
function group({
  name,
  count = 1,
  firstTimestamp = 0,
}: {
  name: string;
  count?: number;
  firstTimestamp?: number;
}): TraceListEventGroup {
  return { name, count, firstTimestamp };
}

/** A row carrying nothing the cell reads, so each case sets only its own state. */
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

/**
 * Renders the cell the way the table does, through the registry entry rather
 * than the component, so a change to what the column registers is caught here.
 */
function renderCell(item: TraceListItem) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {EventsCell.render({ row: item } as never)}
    </ChakraProvider>,
  );
}

/** Five names in first-occurrence order, two past what the cell shows. */
const NAMES = ["a.one", "b.two", "c.three", "d.four", "e.five"];

describe("EventsCell", () => {
  describe("given a trace that recorded one event", () => {
    describe("when the Events cell renders", () => {
      /** @scenario A trace with events shows a badge per event name */
      it("shows a badge naming the event", () => {
        renderCell(
          row({
            events: {
              groups: [group({ name: "thumbs_up_down" })],
              totalCount: 1,
              distinctCount: 1,
            },
          }),
        );

        expect(screen.getByText("thumbs_up_down")).toBeInTheDocument();
      });
    });
  });

  describe("given a trace that repeated the same event", () => {
    describe("when the Events cell renders", () => {
      /** @scenario Repeated events of the same name collapse into one badge with a count */
      it("carries the repeat count on the badge instead of repeating it", () => {
        renderCell(
          row({
            events: {
              groups: [
                group({ name: "tool.output", count: 237 }),
                group({ name: "first_token" }),
              ],
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
    });
  });

  describe("given a trace with more event names than the cell can show", () => {
    describe("when the Events cell renders", () => {
      /** @scenario Overflowing badges collapse into a remainder chip */
      it("shows the first three names and collapses the rest into a remainder chip", () => {
        renderCell(
          row({
            events: {
              groups: NAMES.map((name, i) => group({ name, firstTimestamp: i })),
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
        renderCell(
          row({
            events: {
              groups: NAMES.map((name, i) => group({ name, firstTimestamp: i })),
              totalCount: 5,
              distinctCount: 5,
            },
          }),
        );

        expect(screen.getByText("+2")).toHaveAttribute("title", "d.four, e.five");
      });
    });
  });

  describe("given a trace whose names were trimmed off the read", () => {
    describe("when the Events cell renders", () => {
      /** @scenario A trace with a very large number of events stays bounded */
      it("counts the names trimmed off the rollup into the remainder", () => {
        renderCell(
          row({
            events: {
              // The read returned 4 of the trace's 40 distinct names.
              groups: ["a", "b", "c", "d"].map((name, i) =>
                group({ name, firstTimestamp: i }),
              ),
              totalCount: 100,
              distinctCount: 40,
            },
          }),
        );

        expect(screen.getByText("+37")).toBeInTheDocument();
        expect(screen.getByText("+37")).toHaveAttribute("title", "d, and 36 more");
      });
    });
  });

  describe("given a trace that recorded no events", () => {
    describe("when the Events cell renders", () => {
      /** @scenario A trace with no events shows the empty marker */
      it("shows the empty marker", () => {
        renderCell(row({ events: NO_TRACE_EVENTS }));
        expect(screen.getByText("—")).toBeInTheDocument();
      });
    });
  });

  describe("given the page's events are still loading", () => {
    describe("when the Events cell renders", () => {
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

  describe("given the page's events read failed", () => {
    describe("when the Events cell renders", () => {
      /** @scenario A failed events read says so rather than reading as empty */
      it("says the events are unavailable instead of showing the empty marker", () => {
        renderCell(row({ events: NO_TRACE_EVENTS, eventsUnavailable: true }));

        expect(screen.queryByText("—")).not.toBeInTheDocument();
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
      });
    });
  });
});
