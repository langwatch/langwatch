/**
 * @vitest-environment jsdom
 *
 * The annotation queue walk: a bottom bar whose actions are named in words,
 * correcting the trace in the drawer, marking items for the dataset, and the
 * hand-off that opens once the queue is finished.
 * See specs/annotations/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type TestQueueItem = {
  id: string;
  traceId: string;
  doneAt: Date | null;
};

type TestMark = {
  id: string;
  traceId: string;
};

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  marks: [] as unknown[],
  queuesLoading: false,
  canUpdateAnnotations: true,
  replace: vi.fn(),
  push: vi.fn(),
  openDrawer: vi.fn(),
  setFlowCallbacks: vi.fn(),
  openTrace: vi.fn(),
  enterTraceEditMode: vi.fn(),
  markForDataset: vi.fn(),
  markDone: vi.fn(),
  clearMarks: vi.fn(),
  invalidateQueues: vi.fn(),
  invalidateMarks: vi.fn(),
}));

vi.mock("~/hooks/useAnnotationQueues", () => ({
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    scoreOptions: { data: [] },
    queuesLoading: mocks.queuesLoading,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: (permission: string) =>
      permission === "annotations:update" ? mocks.canUpdateAnnotations : true,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: mocks.push,
    replace: mocks.replace,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    setFlowCallbacks: mocks.setFlowCallbacks,
  }),
}));

vi.mock("~/features/traces-v2/stores/drawerStore", () => ({
  useDrawerStore: { getState: () => ({ openTrace: mocks.openTrace }) },
}));

vi.mock("~/features/traces-v2/utils/traceEditMode", () => ({
  enterTraceEditMode: mocks.enterTraceEditMode,
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/AnnotationsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/icons/TasksDone", () => ({
  TasksDone: () => <div data-testid="tasks-done" />,
}));

vi.mock("~/components/messages/Conversation", () => ({
  Conversation: () => <div data-testid="conversation" />,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: mocks.invalidateQueues },
        getMarkedForDatasetItems: { invalidate: mocks.invalidateMarks },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
    traces: {
      getById: { useQuery: () => ({ data: undefined }) },
    },
    annotation: {
      getMarkedForDatasetItems: {
        useQuery: () => ({ data: mocks.marks, isLoading: false }),
      },
      markQueueItemDone: {
        useMutation: () => ({ mutate: mocks.markDone, isLoading: false }),
      },
      markQueueItemForDataset: {
        useMutation: () => ({ mutate: mocks.markForDataset, isLoading: false }),
      },
      clearDatasetMarks: {
        useMutation: () => ({ mutate: mocks.clearMarks, isLoading: false }),
      },
    },
  },
}));

const { default: MyQueuePage } = await import(
  "~/pages/[project]/annotations/my-queue"
);

const TRACE_STARTED_AT = 1_700_000_000_000;

const setItems = (items: TestQueueItem[]) => {
  mocks.items = items.map((item) => ({
    ...item,
    projectId: "project-1",
    annotationQueueId: "queue-1",
    userId: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    trace: {
      trace_id: item.traceId,
      timestamps: { started_at: TRACE_STARTED_AT },
      metadata: {},
    },
    annotations: [],
  }));
};

// The marks are read on their own, so they are told apart from the queue: a
// mark can point at an item that is already done and out of the walk.
const setMarks = (marks: TestMark[]) => {
  mocks.marks = marks.map((mark) => ({
    ...mark,
    markedForDatasetAt: new Date("2026-08-01T11:00:00Z"),
  }));
};

// A fresh element every time: React skips re-rendering an element it is handed
// by the same reference, which would hide the refreshed queue data.
const page = () => (
  <ChakraProvider value={defaultSystem}>
    <MyQueuePage />
  </ChakraProvider>
);

const renderPage = () => render(page());

const datasetCheckbox = () =>
  screen.getByRole("checkbox", { name: "Add to dataset at the end" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queuesLoading = false;
  mocks.canUpdateAnnotations = true;
  setMarks([]);
  setItems([
    { id: "item-1", traceId: "trace-1", doneAt: null },
    { id: "item-2", traceId: "trace-2", doneAt: null },
    { id: "item-3", traceId: "trace-3", doneAt: null },
  ]);
});

afterEach(() => {
  cleanup();
});

describe("given a reviewer walking their annotation queue", () => {
  describe("when the queue item page renders", () => {
    /** @scenario "The queue bar labels its navigation and actions in words" */
    it("names every action on the bar in words", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: /Previous/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Edit trace/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });

    /** @scenario "The queue bar shows my position in the queue" */
    it("shows the position in the queue", () => {
      renderPage();

      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });
  });

  describe("when the reviewer may not update annotations", () => {
    beforeEach(() => {
      mocks.canUpdateAnnotations = false;
    });

    /** @scenario "A reviewer who cannot update annotations is offered no correction" */
    it("offers no way to edit the trace, and keeps the rest of the bar", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: /Edit trace/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });
  });

  describe("when the reviewer chooses Edit trace", () => {
    /** @scenario "Edit trace opens the trace drawer already in edit mode" */
    it("opens the trace drawer on that trace, already editing", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Edit trace/ }));

      expect(mocks.openTrace).toHaveBeenCalledWith("trace-1", TRACE_STARTED_AT);
      expect(mocks.enterTraceEditMode).toHaveBeenCalledWith("trace-1");
      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-1",
        t: String(TRACE_STARTED_AT),
      });
    });
  });

  describe("when the reviewer ticks the dataset checkbox", () => {
    /** @scenario "Ticking the end-of-queue checkbox marks the open item" */
    it("marks the open queue item for the dataset", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(datasetCheckbox());

      expect(mocks.markForDataset).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1", marked: true },
        expect.anything(),
      );
    });

    /** @scenario "The checkbox answers immediately, before the mark is stored" */
    it("ticks the checkbox before the mark is stored", async () => {
      const user = userEvent.setup();
      // The mutation never answers, so anything ticked is the local answer.
      mocks.markForDataset.mockImplementation(() => undefined);
      renderPage();

      await user.click(datasetCheckbox());

      expect(datasetCheckbox()).toBeChecked();
    });
  });

  describe("when the open item was already marked", () => {
    beforeEach(() => {
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      setMarks([{ id: "item-1", traceId: "trace-1" }]);
    });

    /** @scenario "A mark made earlier is still ticked when the queue is reopened" */
    it("shows the checkbox already ticked", () => {
      renderPage();

      expect(datasetCheckbox()).toBeChecked();
    });

    /** @scenario "Unticking the checkbox takes the mark off the item" */
    it("takes the mark off the item", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(datasetCheckbox());

      expect(mocks.markForDataset).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1", marked: false },
        expect.anything(),
      );
    });
  });

  describe("when the reviewer finishes the last item", () => {
    beforeEach(() => {
      mocks.markDone.mockImplementation(
        (
          input: { queueItemId: string },
          options?: { onSuccess?: () => Promise<void> | void },
        ) => {
          mocks.items = (mocks.items as { id: string }[]).map((item) =>
            item.id === input.queueItemId
              ? { ...item, doneAt: new Date("2026-08-02T10:00:00Z") }
              : item,
          );
          void options?.onSuccess?.();
        },
      );
    });

    /** @scenario "Finishing the last item opens the dataset drawer with the marked traces" */
    it("opens the dataset drawer with the marked traces", async () => {
      const user = userEvent.setup();
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      setMarks([{ id: "item-1", traceId: "trace-1" }]);
      const { rerender } = renderPage();

      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      await waitFor(() => {
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-1"],
        });
      });
    });

    /** @scenario "Traces marked before they were finished are part of the hand-off" */
    it("includes traces that were marked and then finished earlier", async () => {
      const user = userEvent.setup();
      // The finished item is no longer in the walk, but its mark is still read.
      setItems([{ id: "item-2", traceId: "trace-2", doneAt: null }]);
      setMarks([
        { id: "item-1", traceId: "trace-1" },
        { id: "item-2", traceId: "trace-2" },
      ]);
      const { rerender } = renderPage();

      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      await waitFor(() => {
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-1", "trace-2"],
        });
      });
    });

    /** @scenario "Finishing the last item with nothing marked skips the hand-off" */
    it("lands on the finished queue without opening a drawer", async () => {
      const user = userEvent.setup();
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      const { rerender } = renderPage();

      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
    });
  });

  describe("when the reviewer opens a queue that is already finished", () => {
    beforeEach(() => {
      setItems([]);
      setMarks([
        { id: "item-1", traceId: "trace-1" },
        { id: "item-2", traceId: "trace-2" },
      ]);
    });

    /** @scenario "Opening a finished queue that still has marks offers the hand-off" */
    it("offers the hand-off for the marks left behind", async () => {
      renderPage();

      await waitFor(() => {
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-1", "trace-2"],
        });
      });
    });

    /** @scenario "Adding the traces to a dataset takes the marks off" */
    it("clears the marks once the records are added", async () => {
      renderPage();

      await waitFor(() => expect(mocks.setFlowCallbacks).toHaveBeenCalled());
      const [drawer, callbacks] = mocks.setFlowCallbacks.mock.calls[0] as [
        string,
        { onSuccess: () => void },
      ];
      expect(drawer).toBe("addDatasetRecord");
      callbacks.onSuccess();

      expect(mocks.clearMarks).toHaveBeenCalledWith(
        { projectId: "project-1", queueItemIds: ["item-1", "item-2"] },
        expect.anything(),
      );
    });

    /** @scenario "Dismissing the hand-off does not offer it again until the marks change" */
    it("stays quiet until the set of marked items changes", async () => {
      const { rerender } = renderPage();

      await waitFor(() => expect(mocks.openDrawer).toHaveBeenCalledTimes(1));
      rerender(page());
      expect(mocks.openDrawer).toHaveBeenCalledTimes(1);

      setMarks([{ id: "item-1", traceId: "trace-1" }]);
      rerender(page());

      await waitFor(() => expect(mocks.openDrawer).toHaveBeenCalledTimes(2));
    });
  });
});
