/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The one annotations table behind the inbox, my queue, a single queue and all
 * annotations: its columns, its row actions, and its header controls.
 * Spec: specs/annotations/annotations-list-selection.feature.
 */

const mocks = vi.hoisted(() => ({
  // One object for the whole file: the real hook memoizes its period, and a
  // fresh Date per render would make anything keyed on it churn.
  period: {
    startDate: new Date("2026-07-09T00:00:00Z"),
    endDate: new Date("2026-08-08T00:00:00Z"),
  },
  items: [] as unknown[],
  scoreTypes: [] as { id: string; name: string; active: boolean }[],
  queues: [] as { id: string; name: string }[],
  query: {} as Record<string, string>,
  openDrawer: vi.fn(),
  push: vi.fn(),
  requestEnable: vi.fn<() => Promise<boolean>>(),
  deleteMutate: vi.fn(),
  downloadCsv: vi.fn(),
  periodIsDefault: true,
  queueReadArgs: null as Record<string, unknown> | null,
}));

vi.mock("~/hooks/useAnnotationQueues", () => ({
  useAnnotationQueues: (args: Record<string, unknown>) => {
    mocks.queueReadArgs = args;
    return {
      assignedQueueItems: mocks.items,
      totalCount: mocks.items.length,
      queuesLoading: false,
    };
  },
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: mocks.push,
    query: mocks.query,
    pathname: "/[project]/annotations",
  }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: vi.fn() },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
    annotationScore: {
      getAll: { useQuery: () => ({ data: mocks.scoreTypes }) },
    },
    annotation: {
      deleteQueueItems: {
        useMutation: () => ({ mutate: mocks.deleteMutate, isLoading: false }),
      },
      getQueues: { useQuery: () => ({ data: mocks.queues }) },
    },
  },
}));
vi.mock("~/components/PeriodSelector", () => ({
  PeriodSelector: ({
    label,
    clearPeriod,
  }: {
    label?: string;
    clearPeriod?: () => void;
  }) => (
    <div data-testid="period-selector">
      {label ?? "Last 30 days"}
      {clearPeriod && (
        <button type="button" onClick={clearPeriod}>
          All time
        </button>
      )}
    </div>
  ),
  usePeriodSelector: () => ({
    period: mocks.period,
    mode: "relative",
    isDefault: mocks.periodIsDefault,
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
  }),
}));
vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));
vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));
vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children: ReactElement }) => children,
}));
// Kept as a marker rather than removed: whether the reviewer's own permissions
// let them read the content is the point of the wrapper being there at all.
vi.mock("~/components/ui/RedactedField", () => ({
  RedactedField: ({
    field,
    children,
  }: {
    field: string;
    children: React.ReactNode;
  }) => <div data-testid={`redacted-${field}`}>{children}</div>,
}));
vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));
vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: mocks.requestEnable,
    dialogState: { open: false },
  }),
}));
vi.mock("~/utils/downloadCsv", () => ({
  downloadCsv: mocks.downloadCsv,
  csvFileName: (name: string) => `${name} - 2026-08-08.csv`,
}));

import { AnnotationsTable } from "../AnnotationsTable";
import {
  type AnnotationWithUser,
  groupedAnnotationsToRows,
} from "../annotationRow";

const annotation = (
  overrides: Partial<AnnotationWithUser> = {},
): AnnotationWithUser => ({
  id: "annotation-1",
  comment: null,
  expectedOutput: null,
  scoreOptions: null,
  isThumbsUp: null,
  traceId: "trace-1",
  projectId: "project-1",
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

const queuePage = (props: Record<string, unknown> = {}) => (
  <ChakraProvider value={defaultSystem}>
    <AnnotationsTable
      heading="Inbox"
      dateColumnLabel="Date queued"
      showStatusFilter={true}
      rowTarget="queueItem"
      {...props}
    />
  </ChakraProvider>
);

const allPage = (rows: Parameters<typeof groupedAnnotationsToRows>[0]) => (
  <ChakraProvider value={defaultSystem}>
    <AnnotationsTable
      heading="All Annotations"
      dateColumnLabel="Date annotated"
      showStatusFilter={false}
      rowTarget="trace"
      rows={groupedAnnotationsToRows(rows)}
    />
  </ChakraProvider>
);

const columnHeaders = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");

const openRowMenu = async (traceId: string) => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(
    screen.getByRole("button", { name: `Actions for trace ${traceId}` }),
  );
  return user;
};

beforeEach(() => {
  mocks.openDrawer.mockClear();
  mocks.push.mockClear();
  mocks.deleteMutate.mockReset();
  mocks.downloadCsv.mockReset();
  mocks.requestEnable.mockReset();
  mocks.requestEnable.mockResolvedValue(true);
  mocks.query = {};
  mocks.scoreTypes = [];
  mocks.queues = [];
  mocks.periodIsDefault = true;
  mocks.queueReadArgs = null;
  // Column choices live in the browser, so one test's picks must not decide
  // what the next one starts from.
  window.localStorage.clear();
  setItems([{ id: "item-1", traceId: "trace-1" }]);
});
afterEach(cleanup);

describe("AnnotationsTable columns and row actions", () => {
  describe("given the annotations list shows rows", () => {
    /** @scenario "Every row carries an overflow menu" */
    it("ends every row with an actions menu that does not open the row", async () => {
      renderQueuePage();

      await openRowMenu("trace-1");

      expect(await screen.findByText("View trace")).toBeInTheDocument();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
    });

    /** @scenario "View trace opens the trace drawer with the row's timestamp" */
    it("opens the trace drawer with the partition hint", async () => {
      renderQueuePage();

      const user = await openRowMenu("trace-1");
      await user.click(await screen.findByText("View trace"));

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-1",
        t: "1754049600000",
      });
    });

    /** @scenario "Add to dataset from a row opens the drawer for that one trace" */
    it("adds only that row's trace to a dataset", async () => {
      setItems([
        { id: "item-1", traceId: "trace-1" },
        { id: "item-2", traceId: "trace-2" },
      ]);
      renderQueuePage();

      const user = await openRowMenu("trace-2");
      await user.click(await screen.findByText("Add to dataset"));

      await vi.waitFor(() =>
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-2"],
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
        projectId: "project-1",
        queueItemIds: ["item-2"],
      });
    });

    /** @scenario "A pending queue item opens the annotation flow" */
    it("takes a waiting row to the annotation flow", () => {
      renderQueuePage();

      fireEvent.click(screen.getByText("the question"));

      expect(mocks.push).toHaveBeenCalledWith(
        "/acme/annotations/my-queue?queue-item=item-1&trace=trace-1",
      );
    });

    /** @scenario "A finished queue item opens the trace drawer" */
    it("takes a finished row to the trace drawer", () => {
      setItems([
        { id: "item-1", traceId: "trace-1", doneAt: new Date("2026-08-03") },
      ]);
      renderQueuePage();

      fireEvent.click(screen.getByText("the question"));

      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-1",
        t: "1754049600000",
      });
    });

    /** @scenario "Input and output stay behind the redaction marker" */
    it("keeps the input and output behind the redaction marker", () => {
      renderQueuePage();

      expect(
        within(screen.getByTestId("redacted-input")).getByText("the question"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("redacted-output")).getByText("the answer"),
      ).toBeInTheDocument();
    });

    /** @scenario "A queue page dates a row by when it was queued" */
    it("titles the date column by when the row was queued", () => {
      renderQueuePage();

      expect(columnHeaders()).toContain("Date queued");
      expect(columnHeaders()).not.toContain("Date annotated");
    });

    /** @scenario "The row's actions stay reachable however wide the table is" */
    it("pins the actions column to the edge of the table's own scroll", () => {
      renderQueuePage();

      const actionsHeader = screen.getAllByRole("columnheader").at(-1)!;
      const actionsCell = screen.getAllByRole("row")[1]!.lastElementChild!;
      for (const cell of [actionsHeader, actionsCell]) {
        const style = getComputedStyle(cell);
        expect(style.position).toBe("sticky");
        expect(style.right).toBe("0px");
      }
    });

    /** @scenario "A queue page filters by status" */
    it("names the status it is filtering by", () => {
      renderQueuePage();

      expect(
        screen.getByRole("button", { name: /Status: Pending/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "A queue page filters by status" */
    it("offers pending, completed and all", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderQueuePage();

      await user.click(screen.getByRole("button", { name: /Status/ }));

      expect(await screen.findByText("Pending")).toBeInTheDocument();
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.getByText("All")).toBeInTheDocument();
    });

    /** @scenario "A queue page header offers no queue actions" */
    it("leaves editing the queue to the sidebar", () => {
      renderQueuePage({ queueId: "queue-1" });

      expect(
        screen.queryByRole("button", { name: "Queue actions" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Edit queue")).not.toBeInTheDocument();
    });

    /** @scenario "The header controls sit outside the sideways-scrolling region" */
    it("scrolls only the table sideways", () => {
      renderQueuePage();

      const scrollers = screen.getAllByTestId("annotations-table-scroll");
      expect(scrollers).toHaveLength(1);
      const scroller = scrollers[0]!;
      expect(
        scroller.contains(screen.getByRole("button", { name: /Status/ })),
      ).toBe(false);
      expect(
        scroller.contains(screen.getByRole("button", { name: /Export/ })),
      ).toBe(false);
      expect(scroller.contains(screen.getByTestId("period-selector"))).toBe(
        false,
      );
    });

    /** @scenario "A queue page lists every pending item until a range is picked" */
    it("asks for no date range and lists work queued long ago", () => {
      renderQueuePage();

      expect(mocks.queueReadArgs?.startDate).toBeUndefined();
      expect(mocks.queueReadArgs?.endDate).toBeUndefined();
      expect(screen.getByText("the question")).toBeInTheDocument();
      expect(screen.getByTestId("period-selector")).toHaveTextContent(
        "All time",
      );
    });

    describe("when the reviewer picks a date range", () => {
      it("narrows the read to that range and names it", () => {
        mocks.periodIsDefault = false;
        renderQueuePage();

        expect(mocks.queueReadArgs?.startDate).toEqual(mocks.period.startDate);
        expect(mocks.queueReadArgs?.endDate).toEqual(mocks.period.endDate);
        expect(screen.getByTestId("period-selector")).toHaveTextContent(
          "Last 30 days",
        );
      });

      /** @scenario "A queue page can be put back to All time" */
      it("takes the range back off when All time is picked", () => {
        mocks.periodIsDefault = false;
        mocks.query = { period: "30d", pageOffset: "25" };
        renderQueuePage();

        fireEvent.click(screen.getByRole("button", { name: "All time" }));

        expect(mocks.push).toHaveBeenCalledWith(
          { pathname: "/[project]/annotations", query: { pageOffset: "25" } },
          undefined,
          { shallow: true },
        );
      });
    });

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
              scoreOptions: {
                "score-1": { value: "good", reason: "on point" },
              },
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
      expect(call.fileName).toBe("Annotations - 2026-08-08.csv");
    });
  });

  describe("given a row carries comments", () => {
    /** @scenario "Comments are a count chip that opens on hover" */
    it("counts the comments and lists them on hover", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
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
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      setItems([
        {
          id: "item-1",
          traceId: "trace-1",
          annotations: [
            annotation({
              id: "a1",
              comment: "the whole answer misses the point",
            }),
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
      // The comment about the trace as a whole is named by nothing, so a
      // reader never has to work out which of the three is the plain one.
      expect(screen.queryByText("Trace")).not.toBeInTheDocument();
    });

    /** @scenario "Comments are a count chip that opens on hover" */
    it("names nothing for an anchor kind it cannot read", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      setItems([
        {
          id: "item-1",
          traceId: "trace-1",
          annotations: [
            annotation({
              id: "a1",
              comment: "still the reviewer's words",
              // The feed is not anchor-normalised, so a kind written by a newer
              // build arrives as it was stored. Naming it anyway would label the
              // comment with a part of the trace nobody can point at.
              anchorKind: "constellation" as never,
              anchorId: "span-abc123",
              anchorPath: "input",
            }),
          ],
        },
      ]);
      renderQueuePage();

      await user.hover(screen.getByTestId("annotation-comments-chip"));

      expect(
        await screen.findByText("still the reviewer's words"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Span span-abc123 · Input"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A row with no comments shows no chip" */
    it("shows no chip when nothing was said", () => {
      setItems([
        { id: "item-1", traceId: "trace-1", annotations: [annotation()] },
      ]);
      renderQueuePage();

      expect(
        screen.queryByTestId("annotation-comments-chip"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the project collects scores", () => {
    const twoActiveScoreTypes = () => {
      mocks.scoreTypes = [
        { id: "score-1", name: "Helpfulness", active: true },
        { id: "score-2", name: "Tone", active: true },
        { id: "score-3", name: "Retired", active: false },
      ];
      setItems([
        {
          id: "item-1",
          traceId: "trace-1",
          annotations: [
            annotation({
              scoreOptions: {
                "score-1": { value: "good", reason: "on point" },
              },
            }),
          ],
        },
      ]);
    };

    /** @scenario "Every score is folded into one Scores column" */
    it("folds the scores into one column instead of one column per type", () => {
      twoActiveScoreTypes();
      renderQueuePage();

      const headers = columnHeaders();
      expect(headers).toContain("Scores");
      // One column per type is what made a project with a dozen of them
      // unreadable; they are on offer in the columns menu, not on by default.
      expect(headers).not.toContain("Helpfulness");
      expect(headers).not.toContain("Tone");
      expect(headers).not.toContain("Retired");
      expect(screen.getByText("Helpfulness: good")).toBeInTheDocument();
      expect(screen.getAllByRole("row")[1]!.children).toHaveLength(
        headers.length,
      );
    });

    /** @scenario "A score type can be given its own column" */
    it("adds a column for a score type the reviewer picks", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      twoActiveScoreTypes();
      renderQueuePage();

      await user.click(
        screen.getByRole("button", {
          name: "Show or hide columns in the table",
        }),
      );
      await user.click(
        await screen.findByRole("checkbox", { name: "Helpfulness" }),
      );

      expect(columnHeaders()).toContain("Helpfulness");
      expect(columnHeaders()).not.toContain("Tone");
      expect(screen.getAllByRole("row")[1]!.children).toHaveLength(
        columnHeaders().length,
      );
    });

    /** @scenario "Score types that are all inactive add no columns" */
    it("offers no score type when none is active", () => {
      mocks.scoreTypes = [
        { id: "score-1", name: "Retired", active: false },
        { id: "score-2", name: "Also retired", active: false },
      ];
      renderQueuePage();

      const headers = columnHeaders();
      expect(headers).not.toContain("Retired");
      expect(screen.getAllByRole("row")[1]!.children).toHaveLength(
        headers.length,
      );
    });
  });

  describe("given the inbox pools several queues", () => {
    const twoQueues = () => {
      mocks.queues = [
        { id: "queue-1", name: "Tone review" },
        { id: "queue-2", name: "Safety review" },
      ];
    };

    /** @scenario "The inbox reads every queue until one is picked" */
    it("reads them all and says so", () => {
      twoQueues();
      renderQueuePage({ showQueueAndUser: true });

      expect(
        screen.getByRole("button", { name: /Queues: All/ }),
      ).toBeInTheDocument();
      expect(mocks.queueReadArgs?.queueIds).toEqual([]);
    });

    /** @scenario "The inbox narrows to the queues the reviewer picks" */
    it("narrows the read to a picked queue and names it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      twoQueues();
      renderQueuePage({ showQueueAndUser: true });

      await user.click(screen.getByRole("button", { name: /Queues:/ }));
      await user.click(
        await screen.findByRole("checkbox", { name: "Safety review" }),
      );

      expect(mocks.queueReadArgs?.queueIds).toEqual(["queue-2"]);
      expect(
        screen.getByRole("button", { name: /Queues: Safety review/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "A page that is one queue offers no queue filter" */
    it("offers no queue filter where the page is already one queue", () => {
      twoQueues();
      renderQueuePage({ queueId: "queue-1" });

      expect(
        screen.queryByRole("button", { name: /Queues:/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the reviewer wants fewer columns", () => {
    /** @scenario "A column the reviewer hides stays hidden" */
    it("hides a column it is told to hide and remembers the choice", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const view = renderQueuePage();
      expect(columnHeaders()).toContain("Suggestions");

      await user.click(
        screen.getByRole("button", {
          name: "Show or hide columns in the table",
        }),
      );
      await user.click(
        await screen.findByRole("checkbox", { name: "Suggestions" }),
      );

      expect(columnHeaders()).not.toContain("Suggestions");

      view.unmount();
      renderQueuePage();

      expect(columnHeaders()).not.toContain("Suggestions");
      // Input and output are what the reviewer is judging, so they are never
      // the thing a stored choice quietly drops.
      expect(columnHeaders()).toContain("Input");
      expect(columnHeaders()).toContain("Output");
    });
  });

  describe("given a row carries suggestions", () => {
    /** @scenario "Suggestions are a count chip that opens on hover" */
    it("counts the suggestions and lists them with their authors on hover", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
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
      expect(
        screen.getByText("thirty days, not thirty weeks"),
      ).toBeInTheDocument();
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

      expect(
        screen.queryByTestId("annotation-suggestions-chip"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("annotation-comments-chip"),
      ).toBeInTheDocument();
    });

    /** @scenario "A queue page exports the rows on screen" */
    it("exports each suggestion under the part it was left on", () => {
      setItems([
        {
          id: "item-1",
          traceId: "trace-1",
          annotations: [
            annotation({ id: "a1", expectedOutput: "a better answer" }),
            annotation({
              id: "a2",
              expectedOutput: "thirty days",
              anchorKind: "field",
              anchorId: "span-abc123",
              anchorPath: "output",
            }),
          ],
        },
      ]);
      renderQueuePage();

      fireEvent.click(screen.getByRole("button", { name: /Export/ }));

      const call = mocks.downloadCsv.mock.calls[0]?.[0];
      expect(call.rows[0]).toContain(
        "a better answer\nSpan span-abc123 · Output: thirty days",
      );
    });
  });

  describe("given the all annotations page", () => {
    /** @scenario "The all annotations page dates a row by its newest annotation" */
    it("dates a row by its newest annotation", () => {
      render(
        allPage([
          {
            traceId: "trace-1",
            annotations: [
              annotation({
                id: "a1",
                createdAt: new Date("2026-07-01T10:00:00Z"),
              }),
              annotation({
                id: "a2",
                createdAt: new Date("2026-07-20T10:00:00Z"),
              }),
            ],
          },
        ]),
      );

      expect(columnHeaders()).toContain("Date annotated");
      expect(
        screen.getByText(new Date("2026-07-20T10:00:00Z").toLocaleDateString()),
      ).toBeInTheDocument();
    });

    /** @scenario "The all annotations page keeps its own date range" */
    it("names its own window and offers no All time choice", () => {
      render(allPage([{ traceId: "trace-1", annotations: [] }]));

      expect(screen.getByTestId("period-selector")).toHaveTextContent(
        "Last 30 days",
      );
      expect(
        screen.queryByRole("button", { name: "All time" }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The all annotations page has no status filter" */
    it("offers no status filter", () => {
      render(allPage([{ traceId: "trace-1", annotations: [] }]));

      expect(
        screen.queryByRole("button", { name: /Status/ }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A row on the all annotations page opens the trace drawer" */
    it("opens the trace drawer on a row click", () => {
      render(allPage([{ traceId: "trace-1", annotations: [] }]));

      fireEvent.click(screen.getAllByText("<empty>")[0]!);

      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-1",
      });
    });

    /** @scenario "A row with no queue item behind it is never removed from a queue" */
    it("offers no remove-from-queue in the row menu", async () => {
      render(allPage([{ traceId: "trace-1", annotations: [] }]));

      await openRowMenu("trace-1");

      expect(await screen.findByText("View trace")).toBeInTheDocument();
      expect(screen.queryByText("Remove from queue")).not.toBeInTheDocument();
    });

    /** @scenario "Only one page of grouped annotations is shown at a time" */
    it("shows one page of grouped annotations at a time", () => {
      const groups = Array.from({ length: 30 }, (_, i) => ({
        traceId: `trace-${i}`,
        annotations: [],
      }));
      const view = render(allPage(groups));

      // 25 rows plus the header row.
      expect(screen.getAllByRole("row")).toHaveLength(26);
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "30 rows · showing 1–25 · per page",
      );

      mocks.query = { pageOffset: "25" };
      view.rerender(allPage(groups));

      expect(screen.getAllByRole("row")).toHaveLength(6);
    });
  });
});

function renderQueuePage(props: Record<string, unknown> = {}) {
  return render(queuePage(props));
}
