/**
 * @vitest-environment jsdom
 * "Export CSV" on a widget card: the query's answer travels the real transport and executor to
 * the card, and the menu writes one file from the rows the widget already holds. Only the
 * sandboxed frame is stood in for, since jsdom cannot run it.
 * @see modules/analytics/specs/dashboard-widget-export.feature
 */

import type { QueryCompleteness } from "@langwatch/analytics-contract";
import { LWQL_MAX_RESULT_ROWS } from "@langwatch/analytics-contract/langwatch-ql-limits";
import {
  UiProcedureRefusal,
  type UiProcedureAnswer,
  type UiProcedureCall,
} from "@langwatch/browser/testing-transport";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { frameProps } = vi.hoisted(() => ({
  frameProps: vi.fn<(props: SandboxedChartFrameProps) => void>(),
}));

vi.mock("../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx", () => ({
  SandboxedChartFrame: (props: SandboxedChartFrameProps) => {
    frameProps(props);
    return <div data-testid="sandboxed-frame" />;
  },
}));

import { StubAnalyticsHost } from "../../../testing.tsx";
import type { SandboxedChartFrameProps } from "../../dashboard-widget/ui/sections/sandboxed-chart-frame.tsx";
import type { BoardQueryContext } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { BoardWidgetCard } from "../ui/sections/board-widget-card.tsx";
import { CuratedWidgetCard } from "../ui/sections/curated-widget-card.tsx";
import { renderDashboards } from "./render-dashboards.test-helpers.tsx";

/** 2026-10-01T00:00:00Z to 2026-10-08T00:00:00Z: seven whole UTC days. */
const PERIOD: BoardQueryContext = {
  periodStart: Date.UTC(2026, 9, 1),
  periodEnd: Date.UTC(2026, 9, 8),
  granularitySeconds: 86_400,
  excludeOrigins: ["langy"],
};
const DEFINITION = {
  version: 1 as const,
  code: "export default function Widget() { return null; }",
  queries: [{ name: "main", sql: "SELECT model, sum(TotalCost) AS total_cost FROM traces" }],
};
const WIDGET: BoardWidget = {
  id: "w-1",
  name: "Spend by model",
  definition: DEFINITION,
  placement: { graphId: "w-1", gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
};
const COLUMNS = [
  { name: "model", type: "String" },
  { name: "total_cost", type: "Nullable(Float64)" },
];
const NO_TRAFFIC: QueryCompleteness = { state: "no_traffic", unit: "traces", total: 0, fields: [] };

/** The query door's answer: these rows, over the board's period. */
function answering({
  rows,
  completeness,
}: {
  rows: readonly Record<string, unknown>[];
  completeness?: QueryCompleteness;
}) {
  const calls: UiProcedureCall[] = [];
  const answer: UiProcedureAnswer = (call) => {
    calls.push(call);
    if (call.path !== "analytics.lwql.query") {
      return Promise.reject(new Error(`No test answer for ${call.path}`));
    }
    return Promise.resolve({
      columns: COLUMNS,
      rows,
      statistics: { elapsedMs: 1, rowsRead: rows.length, bytesRead: 1, rowsReturned: rows.length },
      diagnostics: [],
      followsTimeWindow: true,
      followsGranularity: false,
      ...(completeness ? { completeness } : {}),
    });
  };
  return { answer, calls };
}

const ROWS = [
  { model: "gpt-5", total_cost: 830.12 },
  { model: "my-finetune-v2", total_cost: null },
];

/** The frame runs the widget's one query, as its code would on load. */
async function frameRunsItsQuery() {
  const props = frameProps.mock.calls.at(-1)?.[0];
  if (!props) throw new Error("the frame never rendered");
  await act(async () => {
    await props
      .executeQuery({ queryName: "main", params: {}, signal: new AbortController().signal })
      .catch(() => undefined);
  });
}

function storedCard({ answer }: { answer: UiProcedureAnswer }) {
  const host = new StubAnalyticsHost();
  renderDashboards({
    element: (
      <BoardWidgetCard
        widget={WIDGET}
        projectId="proj-1"
        projectSlug="test-project"
        dashboardId="board-1"
        boardName="Weekly review"
        period={PERIOD}
        isWriting={false}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    ),
    host,
    answer,
  });
  return host;
}

function curatedCard({ answer }: { answer: UiProcedureAnswer }) {
  const host = new StubAnalyticsHost();
  renderDashboards({
    element: (
      <CuratedWidgetCard
        widget={{
          key: "spend",
          name: "Spend by model",
          definition: DEFINITION,
          layout: { gridColumn: 0, gridRow: 0, colSpan: 4, rowSpan: 4 },
        }}
        frameId="costs-spend"
        boardName="Running costs"
        projectId="proj-1"
        projectSlug="test-project"
        rowSpan={4}
        timeWindow={{ start: PERIOD.periodStart, end: PERIOD.periodEnd }}
        granularitySeconds={PERIOD.granularitySeconds}
        excludeOrigins={PERIOD.excludeOrigins}
      />
    ),
    host,
    answer,
  });
  return host;
}

/** Every file the page handed the browser: its name and its bytes. */
const downloads: { name: string | null; blob: Blob }[] = [];
let lastBlob: Blob | undefined;

beforeEach(() => {
  downloads.length = 0;
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    if (lastBlob) downloads.push({ name: this.getAttribute("download"), blob: lastBlob });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** The one downloaded file: its name, whether it opens with a byte order mark, and its lines. */
async function downloadedFile() {
  expect(downloads).toHaveLength(1);
  const { name, blob } = downloads[0]!;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hasByteOrderMark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = new TextDecoder("utf-8").decode(bytes);
  return { name, hasByteOrderMark, lines: text.split("\r\n") };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Actions for Spend by model" }));
  await screen.findByRole("menu");
};

const exportItem = () => screen.getByRole("menuitem", { name: /^Export CSV/ });

const STAMP = "2026-10-01T00:00:00Z,2026-10-08T00:00:00Z";

describe("given a stored board's widget whose query answered with rows", () => {
  describe("when the reader picks Export CSV in its menu", () => {
    /** @scenario "A stored board's widget exports the rows its queries returned" */
    it("downloads one file of those rows, named for the board, the widget and the period", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = answering({ rows: ROWS });
      const host = storedCard({ answer: server.answer });
      await frameRunsItsQuery();
      const queriesRun = server.calls.length;

      await openMenu(user);
      await user.click(exportItem());

      const file = await downloadedFile();
      expect(file.name).toBe(
        "weekly-review_spend-by-model_query-results_2026-10-01_2026-10-07.csv",
      );
      expect(file.lines).toEqual([
        "Query,model,total_cost,Period start (UTC),Period end (UTC)",
        `main,gpt-5,830.12,${STAMP}`,
        `main,my-finetune-v2,,${STAMP}`,
      ]);
      expect(server.calls).toHaveLength(queriesRun);
      expect(host.successes).toEqual([{ title: "CSV downloaded" }]);
    });
  });

  describe("when its rows hold text a spreadsheet could misread", () => {
    /** @scenario "The file opens cleanly in a spreadsheet" */
    it("opens with a byte order mark, quotes what needs quoting and runs no formula", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const server = answering({
        rows: [
          { model: "modèle-é", total_cost: 1.5 },
          { model: 'said "yes", then left', total_cost: 2 },
          { model: "=SUM(A1:A9)", total_cost: -3 },
        ],
      });
      storedCard({ answer: server.answer });
      await frameRunsItsQuery();

      await openMenu(user);
      await user.click(exportItem());

      const file = await downloadedFile();
      expect(file.hasByteOrderMark).toBe(true);
      expect(file.lines.slice(1)).toEqual([
        `main,modèle-é,1.5,${STAMP}`,
        `main,"said ""yes"", then left",2,${STAMP}`,
        `main,'=SUM(A1:A9),-3,${STAMP}`,
      ]);
    });
  });

  describe("when its query returned as many rows as one request may", () => {
    /** @scenario "A result at the row limit says rows may be missing" */
    it("downloads the file and says rows may be missing", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const rows = Array.from({ length: LWQL_MAX_RESULT_ROWS }, (_, n) => ({
        model: `model-${n}`,
        total_cost: n,
      }));
      const host = storedCard({ answer: answering({ rows }).answer });
      await frameRunsItsQuery();

      await openMenu(user);
      await user.click(exportItem());

      expect((await downloadedFile()).lines).toHaveLength(LWQL_MAX_RESULT_ROWS + 1);
      expect(host.successes).toEqual([
        {
          title: "CSV downloaded",
          description: "A query hit the 10,000-row limit, so rows may be missing.",
        },
      ]);
    });
  });
});

describe("given a stored board's widget with no rows to give", () => {
  /** Opens the menu, tries the item, and reads what it says. */
  async function unavailableItem(user: ReturnType<typeof userEvent.setup>) {
    await openMenu(user);
    expect(exportItem()).toHaveAttribute("aria-disabled", "true");
    await user.click(exportItem());
    expect(downloads).toEqual([]);
    return exportItem().textContent?.trim();
  }

  describe("when no query has answered yet", () => {
    /** @scenario "Export CSV waits for the widget's data" */
    it("cannot be picked, and says it is still loading", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({ answer: answering({ rows: ROWS }).answer });

      expect(await unavailableItem(user)).toBe("Export CSV Still loading");
    });
  });

  describe("when the widget failed to load", () => {
    /** @scenario "Export CSV waits for the widget's data" */
    it("cannot be picked, and says the widget did not load", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({
        answer: () => Promise.reject(new UiProcedureRefusal("lwql_unknown_identifier", 400)),
      });
      await frameRunsItsQuery();

      expect(await unavailableItem(user)).toBe("Export CSV This widget did not load");
    });
  });

  describe("when the period has no traffic", () => {
    /** @scenario "Export CSV waits for the widget's data" */
    it("cannot be picked, and says there is no data in this period", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({ answer: answering({ rows: [], completeness: NO_TRAFFIC }).answer });
      await frameRunsItsQuery();

      expect(await unavailableItem(user)).toBe("Export CSV No data in this period");
    });
  });

  describe("when the reader may not see what its query reads", () => {
    /** @scenario "A widget the reader may not see has no Export CSV" */
    it("has no Export CSV in its menu", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      storedCard({
        answer: () =>
          Promise.reject(
            new UiProcedureRefusal("lwql_not_permitted", 400, {
              violations: [{ code: "GATED_COLUMN", missingGates: ["cost:view"] }],
            }),
          ),
      });
      await frameRunsItsQuery();

      await openMenu(user);

      expect(screen.queryByRole("menuitem", { name: /^Export CSV/ })).toBeNull();
    });
  });
});

describe("given a From LangWatch board's widget whose query answered with rows", () => {
  describe("when the reader opens its menu", () => {
    /** @scenario "A From LangWatch board's widget has a menu that holds only Export CSV" */
    it("offers only Export CSV, which downloads a file named for the board", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const host = curatedCard({ answer: answering({ rows: ROWS }).answer });
      await frameRunsItsQuery();

      await openMenu(user);
      const items = screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
      await user.click(exportItem());

      expect(items).toEqual(["Export CSV"]);
      const file = await downloadedFile();
      expect(file.name).toBe(
        "running-costs_spend-by-model_query-results_2026-10-01_2026-10-07.csv",
      );
      expect(file.lines).toHaveLength(3);
      expect(host.successes).toEqual([{ title: "CSV downloaded" }]);
    });
  });

  describe("when the reader may not see what its query reads", () => {
    /** @scenario "A widget the reader may not see has no Export CSV" */
    it("has no menu at all", async () => {
      curatedCard({
        answer: () =>
          Promise.reject(
            new UiProcedureRefusal("lwql_not_permitted", 400, {
              violations: [{ code: "GATED_COLUMN", missingGates: ["cost:view"] }],
            }),
          ),
      });
      await frameRunsItsQuery();

      expect(screen.queryByRole("button", { name: "Actions for Spend by model" })).toBeNull();
    });
  });
});
