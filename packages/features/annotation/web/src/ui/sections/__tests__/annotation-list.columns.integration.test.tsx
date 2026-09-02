/**
 * @vitest-environment jsdom
 *
 * The one annotations list behind the inbox, my queue, a single queue and all
 * annotations: its columns, its row actions, and its header controls.
 *
 * MOVED from
 * `platform/app/src/components/annotations/__tests__/AnnotationsTable.columns.integration.test.tsx`.
 * Two things changed and both are recorded where they bite: an overlay is
 * observed as the address the host recorded rather than as a call on the
 * application's drawer registry, and the redaction marker is driven by the real
 * redaction read rather than mocked away, which is strictly more than the
 * platform test asserted.
 *
 * THIS FILE FOUND A LIVE DEFECT THE MOVE INTRODUCED, and the two range tests
 * below are the ones that found it. `readAnnotationPeriod` is pure and takes
 * `now`; calling it straight out of a render body gave a relative window a new
 * end timestamp every render, the list's "the picks belong to these rows"
 * effect is keyed on that window, and the two chased each other forever. In a
 * suite it looked like a worker that stalled inside an ordinary synchronous
 * render and walked to its heap ceiling with no failing assertion; in a browser
 * it would have been a render loop and a tRPC round trip per frame. The window
 * is memoised on the address now — `behavior/use-annotation-period.ts`, which
 * is what `platform/app`'s own `usePeriodSelector` did and said why.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnnotationTestHarness,
  StubAnnotationHost,
  type StubAnnotationHostOptions,
} from "../../../testing";

/**
 * Every spy is created once, at hoist time, never inside a mock factory's
 * return value: a hook called on every render would otherwise build a fresh
 * `vi.fn()` per render, and nothing in the test can then assert on the one the
 * component actually held.
 */
const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  scoreTypes: [] as { id: string; name: string; active: boolean }[],
  redaction: {
    isRedacted: { input: false, output: false },
    visibleTo: { input: null as string | null, output: null as string | null },
  },
  deleteMutate: vi.fn(),
  downloadCsv: vi.fn(),
  noop: vi.fn(),
  utils: {
    annotation: {
      getOptimizedAnnotationQueues: { invalidate: vi.fn() },
      getPendingItemsCount: { invalidate: vi.fn() },
      getAssignedItemsCount: { invalidate: vi.fn() },
      getQueueItemsCounts: { invalidate: vi.fn() },
    },
    personalWorkspaceFeatures: { get: { invalidate: vi.fn() } },
  },
  queueReadArgs: null as Record<string, unknown> | null,
}));

vi.mock("../../../behavior/use-annotation-queues", () => ({
  useAnnotationQueues: (args: Record<string, unknown>) => {
    mocks.queueReadArgs = args;
    return {
      assignedQueueItems: mocks.items,
      totalCount: mocks.items.length,
      queuesLoading: false,
    };
  },
}));

vi.mock("../../../behavior/download-csv", () => ({ downloadCsv: mocks.downloadCsv }));

vi.mock("../../../behavior/annotation-api", () => ({
  annotationApi: {
    useUtils: () => mocks.utils,
    annotationScore: { getAll: { useQuery: () => ({ data: mocks.scoreTypes }) } },
    project: {
      getFieldRedactionStatus: {
        useQuery: () => ({ data: mocks.redaction, isLoading: false }),
      },
    },
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: { datasets: true } }) },
      enableAll: { useMutation: () => ({ mutateAsync: mocks.noop, isPending: false }) },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: [] } }),
      },
    },
    annotation: {
      deleteQueueItems: {
        useMutation: () => ({ mutate: mocks.deleteMutate, isPending: false }),
      },
      getQueues: { useQuery: () => ({ data: [] }) },
      createQueueItem: {
        useMutation: () => ({ mutate: mocks.noop, isPending: false }),
      },
    },
  },
}));

// The dataset gate and its dialog have their own suite; here the gate only has
// to answer so a row action can proceed.
vi.mock("../../../behavior/use-personal-feature-gate", () => ({
  usePersonalDatasetGate: () => ({
    isGated: false,
    requestEnable: () => Promise.resolve(true),
    dialogState: {
      open: false,
      onConfirm: mocks.noop,
      onCancel: mocks.noop,
      isEnabling: false,
    },
  }),
}));
vi.mock("../../blocks/personal-feature-gate-dialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

// The range popover has its own module and its own unit tests; here it only
// has to say which window the list is applying and offer the way back.
vi.mock("../../elements/period-picker", () => ({
  PeriodPicker: ({ label, clearPeriod }: { label?: string; clearPeriod?: () => void }) => (
    <div data-testid="period-picker">
      {label ?? "Last 30 days"}
      {clearPeriod && (
        <button type="button" onClick={clearPeriod}>
          All time
        </button>
      )}
    </div>
  ),
}));

const { AnnotationList } = await import("../annotation-list");
const { groupedAnnotationsToRows } = await import("../../../model/annotation-row");
const { csvFileName } = await import("../../../model/annotation-export");
type AnnotationWithUser = import("../../../model/annotation-row").AnnotationWithUser;

const annotation = (overrides: Partial<AnnotationWithUser> = {}): AnnotationWithUser => ({
  id: "annotation-1",
  comment: null,
  expectedOutput: null,
  scoreOptions: null,
  isThumbsUp: null,
  traceId: "trace-1",
  projectId: "proj-1",
  userId: "user-1",
  email: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date("2026-08-02T10:00:00Z"),
  updatedAt: new Date("2026-08-02T10:00:00Z"),
  user: { id: "user-1", name: "Ana", image: null },
  ...overrides,
});

const setItems = (
  items: {
    id: string;
    traceId: string;
    doneAt?: Date | null;
    annotations?: unknown[];
    input?: string;
    output?: string;
    startedAt?: number;
  }[],
) => {
  mocks.items = items.map((item) => ({
    id: item.id,
    traceId: item.traceId,
    doneAt: item.doneAt ?? null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    createdByUser: { id: "queuer", name: "Bo", image: null },
    annotations: item.annotations ?? [],
    trace: {
      trace_id: item.traceId,
      input: { value: item.input ?? "the question" },
      output: { value: item.output ?? "the answer" },
      timestamps: { started_at: item.startedAt ?? 1754049600000 },
    },
  }));
};

type ListProps = Omit<Parameters<typeof AnnotationList>[0], "host">;

function renderList(props: ListProps, options: StubAnnotationHostOptions = {}) {
  const host = new StubAnnotationHost(options);
  const view = render(
    <AnnotationTestHarness host={host}>
      <AnnotationList {...props} host={host} />
    </AnnotationTestHarness>,
  );
  return {
    ...view,
    host,
    onAddress: (next: StubAnnotationHostOptions) => {
      const moved = new StubAnnotationHost(next);
      view.rerender(
        <AnnotationTestHarness host={moved}>
          <AnnotationList {...props} host={moved} />
        </AnnotationTestHarness>,
      );
      return moved;
    },
  };
}

const renderQueuePage = (props: Partial<ListProps> = {}, options: StubAnnotationHostOptions = {}) =>
  renderList({ view: "inbox", ...props }, options);

const renderAllPage = (
  groups: Parameters<typeof groupedAnnotationsToRows>[0],
  options: StubAnnotationHostOptions = {},
) => renderList({ view: "all", rows: groupedAnnotationsToRows(groups) }, options);

const columnHeaders = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");

/**
 * One user-event instance for the whole file. `setup()` installs document-level
 * pointer, keyboard and clipboard state and hands back no way to take it off
 * again, so calling it per test stacks one set of that state per test.
 */
const user = userEvent.setup({ pointerEventsCheck: 0 });

const openRowMenu = async (traceId: string) => {
  await user.click(screen.getByRole("button", { name: `Actions for trace ${traceId}` }));
  return user;
};

/** A range the reviewer actually picked, as the address states it. */
const PICKED_RANGE: StubAnnotationHostOptions = {
  route: { params: {}, query: { period: "30d" } },
};

beforeEach(() => {
  mocks.deleteMutate.mockReset();
  mocks.downloadCsv.mockReset();
  mocks.utils.annotation.getOptimizedAnnotationQueues.invalidate.mockClear();
  mocks.scoreTypes = [];
  mocks.redaction = {
    isRedacted: { input: false, output: false },
    visibleTo: { input: null, output: null },
  };
  mocks.queueReadArgs = null;
  setItems([{ id: "item-1", traceId: "trace-1" }]);
});
afterEach(cleanup);

describe("given the annotations list shows rows", () => {
  /** @scenario "Row actions use an overflow menu" */
  /** @scenario "Every row carries an overflow menu" */
  it("ends every row with an actions menu that does not open the row", async () => {
    const { host } = renderQueuePage();

    await openRowMenu("trace-1");

    expect(await screen.findByText("View trace")).toBeInTheDocument();
    expect(host.navigations).toEqual([]);
    expect(host.queries).toEqual([]);
  });

  /** @scenario "View trace opens the trace drawer with the row's timestamp" */
  it("writes the trace drawer address with the partition hint", async () => {
    const { host } = renderQueuePage();

    const user = await openRowMenu("trace-1");
    await user.click(await screen.findByText("View trace"));

    expect(host.lastQuery).toMatchObject({
      "drawer.open": "traceV2Details",
      "drawer.traceId": "trace-1",
      "drawer.t": "1754049600000",
    });
  });

  /** @scenario "Add to dataset from a row opens the drawer for that one trace" */
  it("adds only that row's trace to a dataset", async () => {
    setItems([
      { id: "item-1", traceId: "trace-1" },
      { id: "item-2", traceId: "trace-2" },
    ]);
    const { host } = renderQueuePage();

    const user = await openRowMenu("trace-2");
    await user.click(await screen.findByText("Add to dataset"));

    await vi.waitFor(() =>
      expect(host.lastQuery).toMatchObject({
        "drawer.open": "addDatasetRecord",
        "drawer.selectedTraceIds": "trace-2",
      }),
    );
  });

  /** @scenario "Remove from queue takes that one item out" */
  it("removes only that queue item", async () => {
    setItems([
      { id: "item-1", traceId: "trace-1" },
      { id: "item-2", traceId: "trace-2" },
    ]);
    renderQueuePage();

    const user = await openRowMenu("trace-2");
    await user.click(await screen.findByText("Remove from queue"));

    expect(mocks.deleteMutate).toHaveBeenCalledWith({
      projectId: "proj-1",
      queueItemIds: ["item-2"],
    });
  });

  /** @scenario "Row navigation follows review state" */
  /** @scenario "A pending queue item opens the annotation flow" */
  it("takes a waiting row to the annotation flow", () => {
    const { host } = renderQueuePage();

    fireEvent.click(screen.getByText("the question"));

    expect(host.navigations).toEqual([
      "/test-project/annotations/my-queue?queue-item=item-1&trace=trace-1",
    ]);
  });

  /** @scenario "A finished queue item opens the trace drawer" */
  it("takes a finished row to the trace drawer", () => {
    setItems([{ id: "item-1", traceId: "trace-1", doneAt: new Date("2026-08-03") }]);
    const { host } = renderQueuePage();

    fireEvent.click(screen.getByText("the question"));

    expect(host.navigations).toEqual([]);
    expect(host.lastQuery).toMatchObject({
      "drawer.open": "traceV2Details",
      "drawer.traceId": "trace-1",
      "drawer.t": "1754049600000",
    });
  });

  /** @scenario "Input and output stay behind the redaction marker" */
  it("shows the content when a privacy rule lets the reader read it", () => {
    renderQueuePage();

    expect(screen.getByText("the question")).toBeInTheDocument();
    expect(screen.getByText("the answer")).toBeInTheDocument();
    expect(screen.queryByText("Redacted")).not.toBeInTheDocument();
  });

  /** @scenario "Input and output stay behind the redaction marker" */
  it("hides the content behind the marker when a privacy rule does not", () => {
    mocks.redaction = {
      isRedacted: { input: true, output: true },
      visibleTo: { input: "Admins", output: "no one" },
    };
    renderQueuePage();

    expect(screen.queryByText("the question")).not.toBeInTheDocument();
    expect(screen.queryByText("the answer")).not.toBeInTheDocument();
    expect(screen.getAllByText("Redacted")).toHaveLength(2);
    expect(screen.getByText("(visible to Admins)")).toBeInTheDocument();
    expect(screen.getByText("(hidden by privacy settings)")).toBeInTheDocument();
  });

  /** @scenario "Dates and compact annotation summaries match the page" */
  /** @scenario "A queue page dates a row by when it was queued" */
  it("titles the date column by when the row was queued", () => {
    renderQueuePage();

    expect(columnHeaders()).toContain("Date queued");
    expect(columnHeaders()).not.toContain("Date annotated");
  });

  /** @scenario "A queue page filters by status" */
  it("offers pending, completed and all", async () => {
    renderQueuePage();

    fireEvent.click(screen.getByRole("button", { name: /Status/ }));

    expect(await screen.findByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
  });

  /** @scenario "A queue page header offers no queue actions" */
  it("leaves editing the queue to the sidebar", () => {
    renderQueuePage({ view: "queue", queueId: "queue-1" });

    expect(screen.queryByRole("button", { name: "Queue actions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Edit queue")).not.toBeInTheDocument();
  });

  /** @scenario "The header controls sit outside the sideways-scrolling region" */
  it("scrolls only the table sideways", () => {
    renderQueuePage();

    const scrollers = screen.getAllByTestId("annotations-table-scroll");
    expect(scrollers).toHaveLength(1);
    const scroller = scrollers[0]!;
    expect(scroller.contains(screen.getByRole("button", { name: /Status/ }))).toBe(false);
    expect(scroller.contains(screen.getByRole("button", { name: /Export/ }))).toBe(false);
    expect(scroller.contains(screen.getByTestId("period-picker"))).toBe(false);
  });

  /** @scenario "Queue pages filter and date their queue items" */
  /** @scenario "A queue page lists every pending item until a range is picked" */
  it("asks for no date range and lists work queued long ago", () => {
    renderQueuePage();

    expect(mocks.queueReadArgs?.startDate).toBeUndefined();
    expect(mocks.queueReadArgs?.endDate).toBeUndefined();
    expect(screen.getByText("the question")).toBeInTheDocument();
    expect(screen.getByTestId("period-picker")).toHaveTextContent("All time");
  });

  describe("when the reviewer picks a date range", () => {
    it("narrows the read to that range and names it", () => {
      renderQueuePage({}, PICKED_RANGE);

      expect(mocks.queueReadArgs?.startDate).toBeInstanceOf(Date);
      expect(mocks.queueReadArgs?.endDate).toBeInstanceOf(Date);
      expect(screen.getByTestId("period-picker")).toHaveTextContent("Last 30 days");
    });

    /** @scenario "A queue page can be put back to All time" */
    it("takes the range back off when All time is picked", () => {
      const { host } = renderQueuePage(
        {},
        { route: { params: {}, query: { period: "30d", pageOffset: "25" } } },
      );

      fireEvent.click(screen.getByRole("button", { name: "All time" }));

      expect(host.lastQuery).toEqual({
        period: undefined,
        startDate: undefined,
        endDate: undefined,
        pageOffset: "25",
      });
    });
  });

  /** @scenario "Export describes the visible list" */
  /** @scenario "A queue page exports the rows on screen" */
  it("exports the rows on screen with the table's own columns", () => {
    mocks.scoreTypes = [{ id: "score-1", name: "Helpfulness", active: true }];
    setItems([
      {
        id: "item-1",
        traceId: "trace-1",
        annotations: [
          annotation({
            comment: "clear enough",
            scoreOptions: { "score-1": { value: "good", reason: "on point" } },
          }),
        ],
      },
      { id: "item-2", traceId: "trace-2" },
    ]);
    renderQueuePage();

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));

    const call = mocks.downloadCsv.mock.calls[0]?.[0];
    expect(call.fields).toEqual([
      "Date queued",
      "Status",
      "Queued by",
      "Trace ID",
      "Input",
      "Output",
      "Comments",
      "Suggestions",
      "Helpfulness",
      "Annotators",
    ]);
    expect(call.rows).toHaveLength(2);
    expect(call.rows[0]).toContain("trace-1");
    expect(call.rows[0]).toContain("Pending");
    expect(call.rows[0]).toContain("good (on point)");
    expect(call.fileName).toBe(csvFileName("Annotations"));
  });
});

describe("given a row carries comments", () => {
  /** @scenario "Comments are a count chip that opens on hover" */
  it("counts the comments and lists them on hover", async () => {
    setItems([
      {
        id: "item-1",
        traceId: "trace-1",
        annotations: [
          annotation({ id: "a1", comment: "reads well" }),
          annotation({
            id: "a2",
            comment: "missing the caveat",
            user: { id: "user-2", name: "Bo", image: null },
          }),
        ],
      },
    ]);
    renderQueuePage();

    const chip = screen.getByTestId("annotation-comments-chip");
    expect(chip).toHaveTextContent("2");

    await user.hover(chip);

    expect(await screen.findByText("reads well")).toBeInTheDocument();
    expect(screen.getByText("missing the caveat")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
  });

  /** @scenario "Comments are a count chip that opens on hover" */
  it("names the part of the trace each comment was left on", async () => {
    setItems([
      {
        id: "item-1",
        traceId: "trace-1",
        annotations: [
          annotation({ id: "a1", comment: "the whole answer misses the point" }),
          annotation({
            id: "a2",
            comment: "this field is wrong",
            anchorKind: "field",
            anchorId: "trace-1",
            anchorPath: "output",
          }),
          annotation({
            id: "a3",
            comment: "the retriever got the wrong question",
            anchorKind: "field",
            anchorId: "span-abc123",
            anchorPath: "input",
          }),
        ],
      },
    ]);
    renderQueuePage();

    await user.hover(screen.getByTestId("annotation-comments-chip"));

    expect(await screen.findByText("Trace · Output")).toBeInTheDocument();
    expect(screen.getByText("Span span-abc123 · Input")).toBeInTheDocument();
    // The comment about the trace as a whole is named by nothing, so a reader
    // never has to work out which of the three is the plain one.
    expect(screen.queryByText("Trace")).not.toBeInTheDocument();
  });

  /** @scenario "A row with no comments shows no chip" */
  it("shows no chip when nothing was said", () => {
    setItems([{ id: "item-1", traceId: "trace-1", annotations: [annotation()] }]);
    renderQueuePage();

    expect(screen.queryByTestId("annotation-comments-chip")).not.toBeInTheDocument();
  });
});

describe("given the project collects scores", () => {
  /** @scenario "Score and content columns follow project and privacy state" */
  /** @scenario "One column per active score type" */
  it("adds one column per active score type and one cell per row", () => {
    mocks.scoreTypes = [
      { id: "score-1", name: "Helpfulness", active: true },
      { id: "score-2", name: "Tone", active: true },
      { id: "score-3", name: "Retired", active: false },
    ];
    renderQueuePage();

    const headers = columnHeaders();
    expect(headers).toContain("Helpfulness");
    expect(headers).toContain("Tone");
    expect(headers).not.toContain("Retired");
    expect(screen.getAllByRole("row")[1]!.children).toHaveLength(headers.length);
  });

  /** @scenario "Score types that are all inactive add no columns" */
  it("adds no score column when none is active", () => {
    mocks.scoreTypes = [
      { id: "score-1", name: "Retired", active: false },
      { id: "score-2", name: "Also retired", active: false },
    ];
    renderQueuePage();

    const headers = columnHeaders();
    expect(headers).not.toContain("Retired");
    expect(screen.getAllByRole("row")[1]!.children).toHaveLength(headers.length);
  });
});

describe("given a row carries suggestions", () => {
  /** @scenario "Suggestions are a count chip that opens on hover" */
  it("counts the suggestions and lists them with their authors on hover", async () => {
    setItems([
      {
        id: "item-1",
        traceId: "trace-1",
        annotations: [
          annotation({ id: "a1", expectedOutput: "a better answer" }),
          annotation({
            id: "a2",
            expectedOutput: "thirty days, not thirty weeks",
            anchorKind: "field",
            anchorId: "span-abc123",
            anchorPath: "output",
            user: { id: "user-2", name: "Bo", image: null },
          }),
        ],
      },
    ]);
    renderQueuePage();

    // The wall of text lives behind the count, so the table stays scannable.
    expect(columnHeaders()).toContain("Suggestions");
    expect(columnHeaders()).not.toContain("Expected output");
    const chip = screen.getByTestId("annotation-suggestions-chip");
    expect(chip).toHaveTextContent("2");
    expect(chip).not.toHaveTextContent("a better answer");

    await user.hover(chip);

    expect(await screen.findByText("a better answer")).toBeInTheDocument();
    expect(screen.getByText("thirty days, not thirty weeks")).toBeInTheDocument();
    expect(screen.getByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("Span span-abc123 · Output")).toBeInTheDocument();
  });

  /** @scenario "A row with no suggestions shows no chip" */
  it("shows no chip when nothing was suggested", () => {
    setItems([
      {
        id: "item-1",
        traceId: "trace-1",
        annotations: [annotation({ comment: "reads well" })],
      },
    ]);
    renderQueuePage();

    expect(screen.queryByTestId("annotation-suggestions-chip")).not.toBeInTheDocument();
    expect(screen.getByTestId("annotation-comments-chip")).toBeInTheDocument();
  });
});

describe("given the all annotations page", () => {
  /** @scenario "The all annotations page dates a row by its newest annotation" */
  it("dates a row by its newest annotation", () => {
    renderAllPage([
      {
        traceId: "trace-1",
        annotations: [
          annotation({ id: "a1", createdAt: new Date("2026-07-01T10:00:00Z") }),
          annotation({ id: "a2", createdAt: new Date("2026-07-20T10:00:00Z") }),
        ],
      },
    ]);

    expect(columnHeaders()).toContain("Date annotated");
    expect(
      screen.getByText(new Date("2026-07-20T10:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
  });

  /** @scenario "All annotations keeps its independent date range and pages grouped rows" */
  /** @scenario "The all annotations page keeps its own date range" */
  it("names its own window and offers no All time choice", () => {
    renderAllPage([{ traceId: "trace-1", annotations: [] }]);

    expect(screen.getByTestId("period-picker")).toHaveTextContent("Last 30 days");
    expect(screen.queryByRole("button", { name: "All time" })).not.toBeInTheDocument();
  });

  /** @scenario "The all annotations page has no status filter" */
  it("offers no status filter", () => {
    renderAllPage([{ traceId: "trace-1", annotations: [] }]);

    expect(screen.queryByRole("button", { name: /Status/ })).not.toBeInTheDocument();
  });

  /** @scenario "A row on the all annotations page opens the trace drawer" */
  it("opens the trace drawer on a row click", () => {
    const { host } = renderAllPage([{ traceId: "trace-1", annotations: [] }]);

    fireEvent.click(screen.getAllByText("<empty>")[0]!);

    expect(host.navigations).toEqual([]);
    expect(host.lastQuery).toEqual({
      "drawer.open": "traceV2Details",
      "drawer.traceId": "trace-1",
    });
  });

  /** @scenario "A row with no queue item behind it is never removed from a queue" */
  it("offers no remove-from-queue in the row menu", async () => {
    renderAllPage([{ traceId: "trace-1", annotations: [] }]);

    await openRowMenu("trace-1");

    expect(await screen.findByText("View trace")).toBeInTheDocument();
    expect(screen.queryByText("Remove from queue")).not.toBeInTheDocument();
  });

  /** @scenario "Only one page of grouped annotations is shown at a time" */
  it("shows one page of grouped annotations at a time", () => {
    const groups = Array.from({ length: 30 }, (_, index) => ({
      traceId: `trace-${index}`,
      annotations: [],
    }));
    const view = renderAllPage(groups);

    // 25 rows plus the header row.
    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
      "30 rows · showing 1–25 · per page",
    );

    view.onAddress({ route: { params: {}, query: { pageOffset: "25" } } });

    expect(screen.getAllByRole("row")).toHaveLength(6);
  });
});
