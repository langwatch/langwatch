/**
 * @vitest-environment jsdom
 *
 * The annotation queue walk: a bottom bar whose actions are named in words,
 * correcting the trace in the drawer, the traces this sitting counts, and the
 * hand-off that has to be answered before the queue celebrates.
 * See specs/annotations/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type TestQueueItem = {
  id: string;
  traceId: string;
  doneAt: Date | null;
  /** The server answers `trace: null` for an item whose trace never resolves. */
  traceMissing?: boolean;
};

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  queuesLoading: false,
  canUpdateAnnotations: true,
  /** Which queue item the URL names, which is what the walk moves between. */
  query: {} as Record<string, string>,
  /** Which drawers the URL currently holds open. */
  openDrawers: [] as string[],
  replace: vi.fn(),
  push: vi.fn(),
  openDrawer: vi.fn(),
  markDone: vi.fn(),
  deleteQueueItems: vi.fn(),
  invalidateQueues: vi.fn(),
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
    query: mocks.query,
    push: mocks.push,
    replace: mocks.replace,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    // Opening a drawer names it in the URL, which is what the page reads back
    // to tell "the reviewer is answering the hand-off" from "they closed it".
    drawerOpen: (drawer: string) => mocks.openDrawers.includes(drawer),
  }),
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

vi.mock("~/features/traces-v2/components/TraceDrawer/conversationView", () => ({
  ConversationView: () => <div data-testid="conversation-view" />,
}));

// The real adapter loads Shiki's grammars and themes; the bar cares about
// none of it, and the conversation it highlights is mocked away above.
vi.mock(
  "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter",
  () => ({
    useShikiAdapter: () => ({ getHighlighter: () => () => null }),
  }),
);

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: mocks.invalidateQueues },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
    }),
    traces: {
      getById: { useQuery: () => ({ data: undefined }) },
    },
    // The conversation the page reads to tell "this thread has no turns in the
    // window" apart from "this thread has not answered yet".
    tracesV2: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    annotation: {
      markQueueItemDone: {
        useMutation: () => ({ mutate: mocks.markDone, isLoading: false }),
      },
      deleteQueueItems: {
        useMutation: () => ({
          mutate: mocks.deleteQueueItems,
          isLoading: false,
        }),
      },
    },
  },
}));

// The drawer store is the real one: "Edit trace" leaves the tab it lands on to
// the shared helper, and what that helper does to the reader's remembered tab
// is the point of the fallback.
const { useDrawerStore } = await import(
  "~/features/traces-v2/stores/drawerStore"
);
const { useAnnotationQueueSessionStore } = await import(
  "~/features/traces-v2/stores/annotationQueueSessionStore"
);
const {
  default: MyQueuePage,
  END_SESSION_QUESTION,
  ROUTE_SETTLE_MS,
} = await import("~/pages/[project]/annotations/my-queue");

const TRACE_STARTED_AT = 1_700_000_000_000;
const LAST_VIEW_MODE_KEY = "langwatch:traces-v2:drawer-last-mode:v1";

const setItems = (items: TestQueueItem[]) => {
  mocks.items = items.map(({ traceMissing, ...item }) => ({
    ...item,
    projectId: "project-1",
    annotationQueueId: "queue-1",
    userId: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    trace: traceMissing
      ? null
      : {
          trace_id: item.traceId,
          timestamps: { started_at: TRACE_STARTED_AT },
          metadata: {},
        },
    annotations: [],
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

/** The walk counts the open item's own trace, so the toggle starts at one. */
const datasetCheckbox = (
  name: string | RegExp = /^Add to dataset at the end/,
) => screen.getByRole("checkbox", { name });

const session = () => useAnnotationQueueSessionStore.getState();

/** What the conversation does when a reviewer saves an annotation on a turn. */
const annotateTurn = (traceId: string) =>
  act(() => session().noteAnnotationSaved(traceId));

/** What the conversation does when a reviewer unticks a turn's checkbox. */
const toggleTurn = (traceId: string) => act(() => session().toggle(traceId));

/** What the add-to-dataset drawer does once the records land. */
const recordsAdded = () => act(() => session().noteHandoffAdded());

/** What the server does with an item the reviewer finishes. */
const marksItemsDone = () => {
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
};

/** Walks the queue to its end with the hand-off switched on. */
const finishQueueWithHandoff = async ({ traceIds }: { traceIds: string[] }) => {
  const user = userEvent.setup();
  setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
  marksItemsDone();
  const view = renderPage();

  await user.click(datasetCheckbox());
  for (const traceId of traceIds) annotateTurn(traceId);
  await user.click(screen.getByRole("button", { name: /Done/ }));
  view.rerender(page());

  await waitFor(() =>
    expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
      selectedTraceIds: traceIds,
    }),
  );
  return { user, view };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queuesLoading = false;
  mocks.canUpdateAnnotations = true;
  mocks.query = {};
  mocks.openDrawers = [];
  // Asking for the hand-off drawer is what puts it in the URL, so the page can
  // tell it was opened and, later, that it was closed again.
  mocks.openDrawer.mockImplementation((drawer: string) => {
    if (drawer === "addDatasetRecord") mocks.openDrawers = [drawer];
  });
  useAnnotationQueueSessionStore.setState({
    active: false,
    marks: {},
    handoff: "idle",
  });
  useDrawerStore.setState({ isOpen: false, viewMode: "summary" });
  localStorage.removeItem(LAST_VIEW_MODE_KEY);
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
      expect(
        screen.getByRole("button", { name: /Edit trace/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });

    /** @scenario "The queue bar shows my position in the queue" */
    it("shows the position in the queue", () => {
      renderPage();

      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });
  });

  describe("when the reviewer chooses Next with items left after this one", () => {
    /** @scenario "Next finishes the item and moves on" */
    it("records the item as done and moves on to the next one", async () => {
      const user = userEvent.setup();
      marksItemsDone();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Next/ }));

      expect(mocks.markDone).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1" },
        expect.anything(),
      );
      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          "/acme/annotations/my-queue?queue-item=item-2",
        ),
      );
    });

    /** @scenario "Next finishes the item and moves on" */
    it("offers no second way forward", () => {
      renderPage();

      expect(screen.getAllByRole("button", { name: /Next/ })).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: /Done/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the last item of the queue is open", () => {
    /** @scenario "The last item's primary action reads Done" */
    it("reads Done instead of Next", () => {
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      renderPage();

      expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Next/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the reviewer may not update annotations", () => {
    beforeEach(() => {
      mocks.canUpdateAnnotations = false;
    });

    /** @scenario "A reviewer who cannot update annotations is offered no correction" */
    it("offers no way to edit the trace, and keeps the rest of the bar", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: /Edit trace/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });
  });

  describe("when the reviewer chooses Edit trace", () => {
    /** @scenario "Edit trace opens the trace drawer already in annotation mode" */
    it("opens the trace drawer on that trace, already editing", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Edit trace/ }));

      expect(mocks.openDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-1",
        t: String(TRACE_STARTED_AT),
        urlParams: { edit: "1" },
      });
    });

    /** @scenario "Edit trace opens the trace drawer already in annotation mode" */
    it("leaves the drawer state to the link, so the two cannot disagree", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Edit trace/ }));

      // Seeding the store here would mount the drawer a frame before the URL
      // names it, and the drawer's URL hydrator reads that frame as "no drawer
      // in the URL, close it", a fight with the sync writing the URL that
      // never settles.
      expect(useDrawerStore.getState().isOpen).toBe(false);
      expect(useDrawerStore.getState().isEditing).toBe(false);
    });

    describe("given the drawer last showed the conversation tab", () => {
      beforeEach(() => {
        localStorage.setItem(LAST_VIEW_MODE_KEY, "conversation");
        useDrawerStore.getState().setViewModeTransient("conversation");
      });

      /** @scenario "Edit trace falls back from the conversation tab to the summary tab" */
      it("opens the drawer on the summary tab instead", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByRole("button", { name: /Edit trace/ }));

        // The queue page already shows the conversation, so a second copy of
        // it in the drawer would say nothing new.
        expect(useDrawerStore.getState().viewMode).toBe("summary");
      });

      /** @scenario "Edit trace falls back from the conversation tab to the summary tab" */
      it("leaves the tab the reader gets elsewhere unchanged", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByRole("button", { name: /Edit trace/ }));

        expect(localStorage.getItem(LAST_VIEW_MODE_KEY)).toBe("conversation");
      });
    });
  });

  describe("when turns are counted into the session", () => {
    /** @scenario "The turn under review is counted from the start" */
    it("counts the open item's own trace before anything is annotated", () => {
      renderPage();

      expect(session().marks).toEqual({ "trace-1": "auto" });
      expect(
        datasetCheckbox("Add to dataset at the end (1 trace)"),
      ).toBeInTheDocument();
    });

    /** @scenario "The turn under review is counted from the start" */
    it("leaves a turn the reviewer unticked out when the walk returns to it", () => {
      const view = renderPage();
      toggleTurn("trace-1");

      mocks.query = { "queue-item": "item-2" };
      view.rerender(page());
      mocks.query = { "queue-item": "item-1" };
      view.rerender(page());

      expect(session().marks["trace-1"]).toBe("off");
      expect(
        datasetCheckbox("Add to dataset at the end (1 trace)"),
      ).toBeInTheDocument();
    });

    /** @scenario "Annotating a turn counts its trace into the session" */
    it("counts an annotated turn's trace on the bar's dataset toggle", () => {
      renderPage();
      expect(
        datasetCheckbox("Add to dataset at the end (1 trace)"),
      ).toBeInTheDocument();

      annotateTurn("trace-9");

      expect(
        datasetCheckbox("Add to dataset at the end (2 traces)"),
      ).toBeInTheDocument();
    });

    /** @scenario "A turn is counted in or out by hand" */
    it("counts a turn in by hand, and an untick wins over the annotation", () => {
      renderPage();

      toggleTurn("trace-2");
      expect(
        datasetCheckbox("Add to dataset at the end (2 traces)"),
      ).toBeInTheDocument();

      annotateTurn("trace-1");
      toggleTurn("trace-1");
      // The reviewer's own untick outranks the automatic count, so annotating
      // that turn again does not quietly put it back.
      annotateTurn("trace-1");

      expect(
        datasetCheckbox("Add to dataset at the end (1 trace)"),
      ).toBeInTheDocument();
    });

    /** @scenario "The dataset toggle carries the live count in traces" */
    it("carries the live count in traces on the toggle", () => {
      renderPage();

      annotateTurn("trace-2");
      annotateTurn("trace-3");
      expect(
        datasetCheckbox("Add to dataset at the end (3 traces)"),
      ).toBeInTheDocument();

      toggleTurn("trace-2");
      toggleTurn("trace-3");

      expect(
        datasetCheckbox("Add to dataset at the end (1 trace)"),
      ).toBeInTheDocument();
    });

    /** @scenario "An empty session disables the dataset toggle" */
    it("disables the dataset toggle once nothing is counted any more", async () => {
      const user = userEvent.setup();
      renderPage();

      toggleTurn("trace-1");

      const toggle = datasetCheckbox("Add to dataset at the end");
      expect(toggle).toBeDisabled();

      await user.click(toggle);

      expect(toggle).not.toBeChecked();
    });

    /** @scenario "Session marks belong to the sitting" */
    it("drops the sitting's count on the way out of the queue", () => {
      const { unmount } = renderPage();
      annotateTurn("trace-2");
      expect(session().marks).toEqual({ "trace-1": "auto", "trace-2": "auto" });

      unmount();

      expect(session().marks).toEqual({});
      expect(session().active).toBe(false);
    });
  });

  describe("when the reviewer finishes the last item", () => {
    beforeEach(() => {
      marksItemsDone();
    });

    /** @scenario "Finishing the last item opens the hand-off over the conversation" */
    it("opens the hand-off over the conversation, and does not celebrate yet", async () => {
      const user = userEvent.setup();
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      const { rerender } = renderPage();
      await user.click(datasetCheckbox());
      annotateTurn("trace-9");

      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      await waitFor(() => {
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-1", "trace-9"],
        });
      });
      // The reviewer is still reading the same conversation: nothing says the
      // queue is finished, and nothing celebrates, until the hand-off resolves.
      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(screen.queryByTestId("tasks-done")).not.toBeInTheDocument();
      expect(mocks.markDone).not.toHaveBeenCalled();
    });

    /** @scenario "Traces counted earlier in the walk are part of the hand-off" */
    it("includes a trace counted earlier in the walk", async () => {
      const user = userEvent.setup();
      setItems([
        { id: "item-1", traceId: "trace-1", doneAt: null },
        { id: "item-2", traceId: "trace-2", doneAt: null },
      ]);
      const { rerender } = renderPage();
      await user.click(datasetCheckbox());

      // The first item is finished and leaves the walk; its trace stays counted.
      await user.click(screen.getByRole("button", { name: /Next/ }));
      rerender(page());
      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      await waitFor(() => {
        expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
          selectedTraceIds: ["trace-1", "trace-2"],
        });
      });
    });

    /** @scenario "Finishing with the dataset toggle off celebrates directly" */
    it("records the item as done and celebrates when the toggle is off", async () => {
      const user = userEvent.setup();
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      const { rerender } = renderPage();

      await user.click(screen.getByRole("button", { name: /Done/ }));
      rerender(page());

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
      expect(mocks.markDone).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1" },
        expect.anything(),
      );
      expect(mocks.openDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given the hand-off drawer is open for the session's traces", () => {
    /** @scenario "The celebration shows once the records are added" */
    it("records the item as done, celebrates and clears the sitting's set", async () => {
      const { view } = await finishQueueWithHandoff({ traceIds: ["trace-1"] });

      recordsAdded();
      view.rerender(page());

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
      expect(mocks.markDone).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1" },
        expect.anything(),
      );
      expect(session().marks).toEqual({});
    });

    /** @scenario "Closing the hand-off without adding asks before ending the session" */
    it("asks before ending the session, and confirming records it done and celebrates", async () => {
      const { user, view } = await finishQueueWithHandoff({
        traceIds: ["trace-1"],
      });

      mocks.openDrawers = [];
      view.rerender(page());

      expect(await screen.findByText(END_SESSION_QUESTION)).toBeInTheDocument();
      expect(screen.queryByTestId("tasks-done")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Confirm" }));

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
      expect(mocks.markDone).toHaveBeenCalledWith(
        { queueItemId: "item-1", projectId: "project-1" },
        expect.anything(),
      );
    });

    /** @scenario "Cancelling the question lands back on the conversation, nothing finished" */
    it("lands back on the conversation with nothing finished and every trace counted", async () => {
      const { user, view } = await finishQueueWithHandoff({
        traceIds: ["trace-1", "trace-2"],
      });
      mocks.openDrawers = [];
      view.rerender(page());
      await screen.findByText(END_SESSION_QUESTION);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(
          screen.queryByText(END_SESSION_QUESTION),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(screen.queryByTestId("tasks-done")).not.toBeInTheDocument();
      expect(mocks.markDone).not.toHaveBeenCalled();
      expect(session().marks).toEqual({ "trace-1": "auto", "trace-2": "auto" });
    });

    /** @scenario "Cancelling the question lands back on the conversation, nothing finished" */
    it("offers the hand-off again after the question was cancelled", async () => {
      const { user, view } = await finishQueueWithHandoff({
        traceIds: ["trace-1"],
      });
      mocks.openDrawers = [];
      view.rerender(page());
      await screen.findByText(END_SESSION_QUESTION);
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await user.click(screen.getByRole("button", { name: /Done/ }));

      expect(mocks.openDrawer).toHaveBeenCalledTimes(2);
      expect(mocks.openDrawer).toHaveBeenLastCalledWith("addDatasetRecord", {
        selectedTraceIds: ["trace-1"],
      });
    });
  });

  describe("when the reviewer opens a queue with nothing left in it", () => {
    /** @scenario "An item whose trace is gone does not hold the finished queue back" */
    it("celebrates, since a fresh sitting has counted nothing", async () => {
      setItems([]);
      renderPage();

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
      expect(mocks.openDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given the trace behind the open item no longer resolves", () => {
    beforeEach(() => {
      setItems([
        {
          id: "item-1",
          traceId: "trace-gone",
          doneAt: null,
          traceMissing: true,
        },
        { id: "item-2", traceId: "trace-2", doneAt: null },
      ]);
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
    it("says the trace is no longer available and offers a way on", () => {
      renderPage();

      expect(
        screen.getByText("This trace is no longer available"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove from queue" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
    it("keeps the queue navigation and drops everything that acts on the trace", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: /Previous/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(screen.getByText("1 of 2")).toBeInTheDocument();

      expect(
        screen.queryByRole("button", { name: /Done/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Edit trace/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: /Add to dataset at the end/ }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
    it("moves on from the bar without finishing anything", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Next/ }));

      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          "/acme/annotations/my-queue?queue-item=item-2",
        ),
      );
      expect(mocks.markDone).not.toHaveBeenCalled();
    });

    /** @scenario "Removing an item whose trace is gone takes it out of the queue" */
    it("removes the item and moves on to the next one", async () => {
      const user = userEvent.setup();
      mocks.deleteQueueItems.mockImplementation(
        (
          _input: unknown,
          options?: { onSuccess?: () => Promise<void> | void },
        ) => void options?.onSuccess?.(),
      );
      renderPage();

      await user.click(
        screen.getByRole("button", { name: "Remove from queue" }),
      );

      expect(mocks.deleteQueueItems).toHaveBeenCalledWith(
        { projectId: "project-1", queueItemIds: ["item-1"] },
        expect.anything(),
      );
      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          "/acme/annotations/my-queue?queue-item=item-2",
        ),
      );
      await waitFor(() => expect(mocks.invalidateQueues).toHaveBeenCalled());
    });

    /** @scenario "Skipping an item whose trace is gone leaves it in the queue" */
    it("moves on without taking the item out of the queue", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "Skip" }));

      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith(
          "/acme/annotations/my-queue?queue-item=item-2",
        ),
      );
      expect(mocks.deleteQueueItems).not.toHaveBeenCalled();
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
    it("offers no removal to a reviewer who may not update annotations", () => {
      mocks.canUpdateAnnotations = false;
      renderPage();

      expect(
        screen.queryByRole("button", { name: "Remove from queue" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    });
  });

  describe("given the only item left is one whose trace no longer resolves", () => {
    beforeEach(() => {
      setItems([
        {
          id: "item-1",
          traceId: "trace-gone",
          doneAt: null,
          traceMissing: true,
        },
      ]);
    });

    /** @scenario "An item whose trace is gone does not hold the finished queue back" */
    it("reads as a finished queue", async () => {
      renderPage();

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
    });
  });

  describe("when the reviewer leaves right after moving to the next item", () => {
    /** @scenario "Leaving mid-navigation leaves nothing pending behind" */
    it("clears the settle timer it armed", async () => {
      const armTimer = vi.spyOn(globalThis, "setTimeout");
      const cancelTimer = vi.spyOn(globalThis, "clearTimeout");

      try {
        const user = userEvent.setup();
        marksItemsDone();
        const { unmount } = renderPage();

        await user.click(screen.getByRole("button", { name: /Next/ }));
        await waitFor(() => expect(mocks.push).toHaveBeenCalled());

        const armed = armTimer.mock.results
          .filter((_, i) => armTimer.mock.calls[i]?.[1] === ROUTE_SETTLE_MS)
          .map((result) => result.value);
        expect(armed.length).toBeGreaterThan(0);

        unmount();

        // Left armed, this fires into an unmounted tree: a stray update under
        // jsdom, and on a torn-down environment the "window is not defined"
        // crash that takes the whole run with it.
        const cancelled = cancelTimer.mock.calls.map(([id]) => id);
        for (const timer of armed) expect(cancelled).toContain(timer);
      } finally {
        armTimer.mockRestore();
        cancelTimer.mockRestore();
      }
    });
  });
});
