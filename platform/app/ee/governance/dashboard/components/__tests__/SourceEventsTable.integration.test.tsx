// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The events table on the ingestion-source detail page: a cursor-walked
 * ListTable that pages through every event the source ever ingested.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (rule "The events table pages through everything the source
 *       ever ingested")
 *
 * The harness feeds the real pager hook a fake server that mimics the
 * endpoint's actual contract: strictly-older-than-cursor, newest first,
 * sliced to limit, no total.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PageRequest } from "@langwatch/enterprise-governance-web";
import {
  type SourceEventRowData,
  SourceEventsTable,
} from "../SourceEventsTable";
import { useSourceEventsPager } from "../useSourceEventsPager";

const BASE_TS = Date.now() - 5 * 60 * 1000; // recent, so times read "ago"

function makeEvent({
  id,
  ts,
  ...overrides
}: {
  id: string;
  ts: number;
} & Partial<SourceEventRowData>): SourceEventRowData {
  return {
    eventId: id,
    eventType: "api_call",
    actor: "dev@acme.test",
    action: "chat.completion",
    target: "claude-sonnet-5",
    costUsd: "0.0250",
    tokensInput: 120,
    tokensOutput: 480,
    eventTimestampIso: new Date(ts).toISOString(),
    ingestedAtIso: new Date(ts + 500).toISOString(),
    rawPayload: JSON.stringify({ marker: `raw-${id}` }),
    ...overrides,
  };
}

/** The endpoint's real behaviour: ts < cursor, newest first, slice(limit). */
function fakeServer(events: SourceEventRowData[]) {
  return vi.fn(async (req: PageRequest) => {
    const beforeMs = req.beforeIso ? Date.parse(req.beforeIso) : Date.now();
    return events
      .filter((e) => Date.parse(e.eventTimestampIso) < beforeMs)
      .sort(
        (a, b) =>
          Date.parse(b.eventTimestampIso) - Date.parse(a.eventTimestampIso) ||
          b.eventId.localeCompare(a.eventId),
      )
      .slice(0, req.limit);
  });
}

function Harness({
  fetchPage,
  pageSize,
}: {
  fetchPage: (req: PageRequest) => Promise<SourceEventRowData[]>;
  pageSize: number;
}) {
  const pager = useSourceEventsPager({
    enabled: true,
    initialPageSize: pageSize,
    fetchPage,
  });
  return (
    <SourceEventsTable
      pager={pager}
      emptyState={<div>walkthrough: push your first event</div>}
    />
  );
}

const renderTable = (props: Parameters<typeof Harness>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness {...props} />
    </ChakraProvider>,
  );

describe("given a source with ingested events", () => {
  /** @scenario "Events render as a table, newest first" */
  it("renders the events as table rows, newest first, with every column", async () => {
    const events = [
      makeEvent({ id: "new", ts: BASE_TS + 2000, actor: "newest@acme.test" }),
      makeEvent({ id: "old", ts: BASE_TS + 1000, actor: "oldest@acme.test" }),
    ];
    renderTable({ fetchPage: fakeServer(events), pageSize: 10 });

    const table = await screen.findByRole("table");
    for (const header of [
      "Time",
      "Type",
      "Actor",
      "Action",
      "Target",
      "Cost",
      "Tokens",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeTruthy();
    }
    const rows = within(table).getAllByTestId("source-event-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("newest@acme.test")).toBeTruthy();
    expect(within(rows[1]!).getByText("oldest@acme.test")).toBeTruthy();
    // Relative time reads as "ago"; the exact instant lives in a tooltip.
    expect(within(rows[0]!).getByText(/ago/)).toBeTruthy();
  });

  /** @scenario "A row opens into raw + normalised detail" */
  it("expands a clicked row into raw + normalised detail and folds it on a second click", async () => {
    const user = userEvent.setup();
    renderTable({
      fetchPage: fakeServer([makeEvent({ id: "only", ts: BASE_TS })]),
      pageSize: 10,
    });
    const rowEl = await screen.findByTestId("source-event-row");

    await user.click(rowEl);
    expect(screen.getByText("Normalised (OCSF)")).toBeTruthy();
    expect(screen.getByText("Raw payload (as ingested)")).toBeTruthy();
    expect(screen.getByText(/raw-only/)).toBeTruthy();

    await user.click(rowEl);
    expect(screen.queryByText("Normalised (OCSF)")).toBeNull();
  });

  /** @scenario "A row opens into raw + normalised detail" */
  it("says a pushed event's raw body was never stored instead of an empty panel", async () => {
    const user = userEvent.setup();
    renderTable({
      fetchPage: fakeServer([
        makeEvent({ id: "pushed", ts: BASE_TS, rawPayload: "" }),
      ]),
      pageSize: 10,
    });
    await user.click(await screen.findByTestId("source-event-row"));
    expect(screen.getByText("Normalised (OCSF)")).toBeTruthy();
    expect(
      screen.getByText(/raw body is not stored for this source type/i),
    ).toBeTruthy();
  });

  /** @scenario "A row opens into raw + normalised detail" */
  it("opens and closes the detail from the keyboard as well as the mouse", async () => {
    const user = userEvent.setup();
    renderTable({
      fetchPage: fakeServer([makeEvent({ id: "only", ts: BASE_TS })]),
      pageSize: 10,
    });
    const rowEl = await screen.findByTestId("source-event-row");

    rowEl.focus();
    expect(rowEl).toHaveProperty("tabIndex", 0);
    await user.keyboard("{Enter}");
    expect(screen.getByText("Normalised (OCSF)")).toBeTruthy();
    expect(rowEl.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Enter}");
    expect(screen.queryByText("Normalised (OCSF)")).toBeNull();
    expect(rowEl.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a dash, never 'Invalid Date', for a timestamp that does not parse", async () => {
    const user = userEvent.setup();
    // Not through fakeServer: its cursor filter needs a parseable
    // timestamp, and the point here is what the CELL does with a bad one.
    renderTable({
      fetchPage: async () => [
        makeEvent({
          id: "only",
          ts: BASE_TS,
          eventTimestampIso: "not-a-timestamp",
        }),
      ],
      pageSize: 10,
    });
    const rowEl = await screen.findByTestId("source-event-row");
    await user.hover(within(rowEl).getAllByText("—")[0]!);
    expect(screen.queryByText(/invalid date/i)).toBeNull();
  });
});

describe("given more events than one page holds", () => {
  const twelve = Array.from({ length: 12 }, (_, i) =>
    makeEvent({
      id: `e${String(i).padStart(2, "0")}`,
      ts: BASE_TS - i * 1000,
      actor: `actor-e${String(i).padStart(2, "0")}@acme.test`,
    }),
  );

  /** @scenario "The table pages through more events than fit at once" */
  it("walks to the next page of older events and back to the exact rows it left", async () => {
    const user = userEvent.setup();
    const server = fakeServer(twelve);
    renderTable({ fetchPage: server, pageSize: 10 });

    await screen.findByText("actor-e00@acme.test");
    expect(screen.queryByText("actor-e10@acme.test")).toBeNull();

    await user.click(screen.getByTestId("pagination-next"));
    await screen.findByText("actor-e10@acme.test");
    expect(screen.queryByText("actor-e00@acme.test")).toBeNull();
    expect(screen.getByText("actor-e11@acme.test")).toBeTruthy();

    const fetchesAfterWalk = server.mock.calls.length;
    await user.click(screen.getByTestId("pagination-prev"));
    await screen.findByText("actor-e00@acme.test");
    expect(screen.queryByText("actor-e10@acme.test")).toBeNull();
    // Going back re-reads what was already loaded; it does not refetch.
    expect(server.mock.calls.length).toBe(fetchesAfterWalk);
  });

  /** @scenario "Changing rows-per-page starts over from the first page" */
  it("returns to the first page at the new size when rows-per-page changes", async () => {
    const user = userEvent.setup();
    renderTable({ fetchPage: fakeServer(twelve), pageSize: 10 });

    await screen.findByText("actor-e00@acme.test");
    await user.click(screen.getByTestId("pagination-next"));
    await screen.findByText("actor-e10@acme.test");

    await user.selectOptions(screen.getByTestId("pagination-page-size"), "25");
    await screen.findByText("actor-e00@acme.test");
    // All twelve fit on the one, first page now.
    expect(screen.getByText("actor-e11@acme.test")).toBeTruthy();
  });
});

describe("given events stamped with the same millisecond straddling a page boundary", () => {
  /** @scenario "Events sharing a timestamp are not lost at a page boundary" */
  it("recovers tied events that fell off the previous page's slice", async () => {
    const user = userEvent.setup();
    const T = BASE_TS;
    // 9 distinct + 3 tied at T; page size 10 cuts through the tie: page 1
    // ends with 1 tied row shown, 2 tied rows unreachable to a naive walk.
    const distinct = Array.from({ length: 9 }, (_, i) =>
      makeEvent({
        id: `d${i}`,
        ts: T + (9 - i) * 1000,
        actor: `actor-d${i}@acme.test`,
      }),
    );
    const tied = ["z", "y", "x"].map((s) =>
      makeEvent({ id: `tie-${s}`, ts: T, actor: `actor-tie-${s}@acme.test` }),
    );
    const server = fakeServer([...distinct, ...tied]);
    renderTable({ fetchPage: server, pageSize: 10 });

    await screen.findByText("actor-d0@acme.test");
    expect(screen.getByText("actor-tie-z@acme.test")).toBeTruthy();
    expect(screen.queryByText("actor-tie-x@acme.test")).toBeNull();

    await user.click(screen.getByTestId("pagination-next"));
    await screen.findByText("actor-tie-y@acme.test");
    expect(screen.getByText("actor-tie-x@acme.test")).toBeTruthy();
    // And nothing shown twice: the tied row from page 1 stays on page 1.
    expect(screen.queryByText("actor-tie-z@acme.test")).toBeNull();
  });
});

describe("given the page stays mounted while the source it addresses changes", () => {
  it("throws away the old source's pages and loads the new source's events", async () => {
    // Multi-hop history navigation lands on another :id without a remount;
    // the pager must not keep showing the previous source's events.
    const sourceA = fakeServer([
      makeEvent({ id: "a1", ts: BASE_TS, actor: "actor-source-a@acme.test" }),
    ]);
    const sourceB = fakeServer([
      makeEvent({ id: "b1", ts: BASE_TS, actor: "actor-source-b@acme.test" }),
    ]);
    const view = renderTable({ fetchPage: sourceA, pageSize: 10 });
    await screen.findByText("actor-source-a@acme.test");

    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <Harness fetchPage={sourceB} pageSize={10} />
      </ChakraProvider>,
    );
    await screen.findByText("actor-source-b@acme.test");
    expect(screen.queryByText("actor-source-a@acme.test")).toBeNull();
  });
});

describe("given React mounts the table twice, as StrictMode does in development", () => {
  it("loads the first page exactly once, never a duplicate", async () => {
    const server = fakeServer([
      makeEvent({ id: "only", ts: BASE_TS, actor: "actor-once@acme.test" }),
    ]);
    render(
      <StrictMode>
        <ChakraProvider value={defaultSystem}>
          <Harness fetchPage={server} pageSize={10} />
        </ChakraProvider>
      </StrictMode>,
    );
    await screen.findByText("actor-once@acme.test");
    // A second landing of the same walk must be dropped, not appended
    // as a phantom second page.
    expect(screen.getAllByTestId("source-event-row")).toHaveLength(1);
    expect(screen.queryByTestId("pagination-page-2")).toBeNull();
  });

  it("shows the page the second walk fetched when the first one failed", async () => {
    // Both starts share a generation and one in-flight flag, so only a
    // per-walk id can tell the outdated failure from the landing that
    // actually carries rows.
    const realServer = fakeServer([
      makeEvent({ id: "only", ts: BASE_TS, actor: "actor-second@acme.test" }),
    ]);
    let shouldFailNext = true;
    const flakyServer = vi.fn(async (req: PageRequest) => {
      if (shouldFailNext) {
        shouldFailNext = false;
        throw new Error("transient");
      }
      return realServer(req);
    });
    render(
      <StrictMode>
        <ChakraProvider value={defaultSystem}>
          <Harness fetchPage={flakyServer} pageSize={10} />
        </ChakraProvider>
      </StrictMode>,
    );

    await screen.findByText("actor-second@acme.test");
    expect(screen.queryByText("Couldn't load this source's events")).toBeNull();
  });
});

describe("given a page fetch fails mid-walk", () => {
  /** @scenario "A failed load is an error, never an empty list" */
  it("keeps the rows already loaded and lets the next click retry", async () => {
    const user = userEvent.setup();
    const twelve = Array.from({ length: 12 }, (_, i) =>
      makeEvent({
        id: `e${String(i).padStart(2, "0")}`,
        ts: BASE_TS - i * 1000,
        actor: `actor-e${String(i).padStart(2, "0")}@acme.test`,
      }),
    );
    const realServer = fakeServer(twelve);
    let shouldFailNext = false;
    const flakyServer = vi.fn(async (req: PageRequest) => {
      if (shouldFailNext) {
        shouldFailNext = false;
        throw new Error("transient");
      }
      return realServer(req);
    });
    renderTable({ fetchPage: flakyServer, pageSize: 10 });
    await screen.findByText("actor-e00@acme.test");

    shouldFailNext = true;
    await user.click(screen.getByTestId("pagination-next"));
    await screen.findByText("Couldn't load more events");
    // The walked pages survive the failure.
    expect(screen.getByText("actor-e00@acme.test")).toBeTruthy();

    await user.click(screen.getByTestId("pagination-next"));
    await screen.findByText("actor-e10@acme.test");
    expect(screen.queryByText("Couldn't load more events")).toBeNull();
  });
});

describe("given the events request fails", () => {
  /** @scenario "A failed load is an error, never an empty list" */
  it("shows an error and never the empty-state walkthrough", async () => {
    renderTable({
      fetchPage: vi.fn(async () => {
        throw new Error("boom");
      }),
      pageSize: 10,
    });
    await screen.findByText("Couldn't load this source's events");
    expect(screen.queryByText("walkthrough: push your first event")).toBeNull();
  });
});

describe("given a source that has ingested nothing", () => {
  it("shows the setup walkthrough and no pagination bar", async () => {
    renderTable({ fetchPage: fakeServer([]), pageSize: 10 });
    await screen.findByText("walkthrough: push your first event");
    expect(screen.queryByTestId("pagination")).toBeNull();
  });
});

describe("given the pager can only honour what the cursor gives it", () => {
  /** @scenario "The pager offers no control it cannot honour" */
  it("offers no sort headers, no search box and no grand total", async () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ id: `e${i}`, ts: BASE_TS - i * 1000 }),
    );
    renderTable({ fetchPage: fakeServer(events), pageSize: 10 });
    const table = await screen.findByRole("table");

    for (const header of within(table).getAllByRole("columnheader")) {
      expect(within(header).queryByRole("button")).toBeNull();
    }
    expect(screen.queryByRole("textbox")).toBeNull();

    const indicator = screen.getByTestId("pagination-indicator");
    expect(indicator.textContent).toContain("showing 1–10");
    expect(indicator.textContent).not.toMatch(/\d+\s*events/);

    await waitFor(() => {
      // One loaded page + the sentinel: page 2 offered, page 3 not.
      expect(screen.getByTestId("pagination-page-2")).toBeTruthy();
      expect(screen.queryByTestId("pagination-page-3")).toBeNull();
    });
  });
});
