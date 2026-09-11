/**
 * @vitest-environment jsdom
 */
import { AnnotationTestHarness, StubAnnotationHost } from "@langwatch/annotation-web/testing";
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
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/__tests__/annotation-queue-walker-bar.integration.test.tsx
  queuesReady: true,
  queuesError: undefined as unknown | undefined,
  scopeStatus: "ready" as "loading" | "ready" | "unavailable",
=======
  /**
   * Whether the step being served is the item the reviewer has left, with the
   * one the URL names still being read.
   */
  stepIsStale: false,
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/__tests__/my-queue-bar.integration.test.tsx
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

<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/__tests__/annotation-queue-walker-bar.integration.test.tsx
vi.mock("@langwatch/ui-host/session", () => ({
  useActiveScope: () => ({
    status: mocks.scopeStatus,
    project: mocks.scopeStatus === "ready" ? { id: "project-1", slug: "acme" } : undefined,
  }),
  usePermissions: () => ({
    can: (permission: string) =>
=======
/**
 * The walk reads one step at a time, so the fixture queue stands in for the
 * server and the step is derived from it the way the procedure derives it:
 * the item the URL names or the first one waiting, its rank, and the ids
 * either side. Items the reviewer has finished leave the walk.
 */
vi.mock("~/hooks/useAnnotationQueueWalk", () => ({
  useAnnotationQueueWalk: ({ queueItemId }: { queueItemId?: string }) => {
    const pending = (
      mocks.items as { id: string; doneAt: Date | null; trace: unknown }[]
    ).filter((item) => !item.doneAt);
    const asked = Math.max(
      0,
      pending.findIndex((item) => item.id === queueItemId),
    );
    // A stale step is the previous item still being served while the one the
    // URL names is read — which is what `keepPreviousData` does in the hook.
    // Deriving it from the URL instead would serve the item the reviewer asked
    // for, and no test could then tell a held control from a useless one.
    const index = mocks.stepIsStale ? Math.max(0, asked - 1) : asked;
    const item = pending[index] ?? null;

    return {
      item,
      position: item ? index + 1 : 0,
      total: pending.length,
      previousItemId: pending[index - 1]?.id ?? null,
      nextItemId: item ? (pending[index + 1]?.id ?? null) : null,
      // Nothing readable left is what ends the walk, which an empty queue and
      // a queue of unresolvable traces both are.
      queueFinished: pending.every((entry) => !entry.trace),
      queueLoading: mocks.queuesLoading,
      stepIsStale: mocks.stepIsStale,
    };
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: (permission: string) =>
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/__tests__/my-queue-bar.integration.test.tsx
      permission === "annotations:update" ? mocks.canUpdateAnnotations : true,
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    query: mocks.query,
    push: mocks.push,
    replace: mocks.replace,
  }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    // Opening a drawer names it in the URL, which is what the page reads back
    // to tell "the reviewer is answering the hand-off" from "they closed it".
    drawerOpen: (drawer: string) => mocks.openDrawers.includes(drawer),
  }),
}));

vi.mock("@langwatch/trace-web/surfaces/conversation-view", () => ({
  ConversationView: () => <div data-testid="conversation-view" />,
}));

// The real adapter loads Shiki's grammars and themes; the page cares about none of it, and the
// conversation it highlights is mocked away above. PARTIAL, and it has to be:
// `@langwatch/trace-web` is that package's own entry, and its internals import through it —
// `useDrawerProjectId` reads `useDrawerStore` off the same module — so replacing the whole
// entry takes the stores the walker's own conversation hook needs with it.
vi.mock("@langwatch/trace-web", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useShikiAdapter: () => ({ getHighlighter: () => () => null }),
}));

vi.mock("@langwatch/trace-web/surfaces/conversation-turns", () => ({
  useConversationTurns: () => ({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
}));

vi.mock("@langwatch/annotation-web/annotations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    scoreOptions: { data: [] },
    queuesLoading: mocks.queuesLoading,
    queuesReady: mocks.queuesReady,
    queuesError: mocks.queuesError,
  }),
  useShowErrorToast: () => vi.fn(),
  AnnotationQueueLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TasksDone: () => <div data-testid="tasks-done" />,
  annotationApi: {
    useUtils: () => ({
      annotation: {
        getQueueWalkStep: { invalidate: mocks.invalidateQueues },
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

// The drawer store is the real one: "Edit trace" leaves the tab it lands on to the shared
// helper, and what that helper does to the reader's remembered tab is the point of the
// fallback.
const { useDrawerStore } = await import("@langwatch/trace-web/surfaces/trace-drawer-store");
const { useAnnotationQueueSessionStore } =
  await import("@langwatch/trace-web/surfaces/annotation-queue-session");
const {
  default: MyQueuePage,
  END_SESSION_QUESTION,
  ROUTE_SETTLE_MS,
} = await import("../annotation-queue-walker");

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
/**
 * The walker mounts the TRACE host as well as its own, so the bridge can reach both.
 */
const page = () => (
  <AnnotationTestHarness
    host={
      new StubAnnotationHost({
        project: { id: "project-1", slug: "acme", name: "Acme" },
        currentUser: { id: "user-1", name: "Ada", image: null },
        permissions: ["annotations:update", "annotations:manage"],
      })
    }
  >
    <MyQueuePage />
  </AnnotationTestHarness>
);

const renderPage = () => render(page());

/** The walk counts the open item's own trace, so the toggle starts at one. */
const datasetCheckbox = (name: string | RegExp = /^Add to dataset at the end/) =>
  screen.getByRole("checkbox", { name });

const session = () => useAnnotationQueueSessionStore.getState();

/** What the conversation does when a reviewer saves an annotation on a turn. */
const annotateTurn = (traceId: string) => act(() => session().noteAnnotationSaved(traceId));

/** What the conversation does when a reviewer unticks a turn's checkbox. */
const toggleTurn = (traceId: string) => act(() => session().toggle(traceId));

/** What the add-to-dataset drawer does once the records land. */
const recordsAdded = () => act(() => session().noteHandoffAdded());

/** What the server does with an item the reviewer finishes. */
const marksItemsDone = () => {
  mocks.markDone.mockImplementation(
    (input: { queueItemId: string }, options?: { onSuccess?: () => Promise<void> | void }) => {
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
<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/__tests__/annotation-queue-walker-bar.integration.test.tsx
  mocks.queuesReady = true;
  mocks.queuesError = undefined;
  mocks.scopeStatus = "ready";
=======
  mocks.stepIsStale = false;
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/__tests__/my-queue-bar.integration.test.tsx
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
    /** @scenario "The queue bar has one labelled forward action" */
    it("names every action on the bar in words", () => {
      renderPage();

      expect(screen.getByRole("button", { name: /Previous/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Edit trace/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });

    /** @scenario "The final action is explicit" */
    it("shows the position in the queue", () => {
      renderPage();

      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });

    it("waits for the active project instead of treating its disabled queue query as complete", () => {
      mocks.scopeStatus = "loading";
      renderPage();

      expect(screen.getByText("Loading annotation queue")).toBeInTheDocument();
      expect(screen.queryByText("All tasks complete")).not.toBeInTheDocument();
    });

    it("shows a queue failure instead of treating a failed read as complete", () => {
      mocks.queuesReady = false;
      mocks.queuesError = new Error("offline");
      renderPage();

      expect(screen.getByText("Couldn't load your annotation queue")).toBeInTheDocument();
      expect(screen.queryByText("All tasks complete")).not.toBeInTheDocument();
    });

    it("explains when no active project is available", () => {
      mocks.scopeStatus = "unavailable";
      renderPage();

      expect(screen.getByText("Annotation queue unavailable")).toBeInTheDocument();
      expect(screen.queryByText("All tasks complete")).not.toBeInTheDocument();
    });
  });

  describe("when the reviewer has stepped on and the new item is still being read", () => {
    /** @scenario "Nothing acts on the item I have just stepped off" */
    it("holds every action that would otherwise act on the item left behind", () => {
      // The URL already names the item asked for, while the step in hand is
      // still the one being left. Acting now finishes, or annotates, the item
      // the reviewer has stepped away from.
      mocks.query = { "queue-item": "item-2" };
      mocks.stepIsStale = true;
      renderPage();

      expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Edit trace/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    });

    /** @scenario "Nothing acts on the item I have just stepped off" */
    it("holds the conversation, whose own controls would write to the item left behind", () => {
      mocks.query = { "queue-item": "item-2" };
      mocks.stepIsStale = true;
      renderPage();

      // Annotating, ticking a turn into the session and opening a turn all
      // belong to the conversation rather than the bar, and annotating writes.
      // The hold therefore sits on the subtree that hosts them, which is what
      // the reviewer sees dim while the item they asked for is read.
      const thread = screen
        .getByTestId("conversation-view")
        .closest("[aria-busy]");

      expect(thread).toHaveAttribute("aria-busy", "true");
      expect(thread).toHaveStyle({ pointerEvents: "none" });
    });
  });

  describe("when the reviewer chooses Next with items left after this one", () => {
    /** @scenario "The queue bar has one labelled forward action" */
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
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/my-queue?queue-item=item-2"),
      );
    });

    /** @scenario "The queue bar has one labelled forward action" */
    it("offers no second way forward", () => {
      renderPage();

      expect(screen.getAllByRole("button", { name: /Next/ })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /Done/ })).not.toBeInTheDocument();
    });
  });

  describe("given the last item of the queue is open", () => {
    /** @scenario "The final action is explicit" */
    it("reads Done instead of Next", () => {
      setItems([{ id: "item-1", traceId: "trace-1", doneAt: null }]);
      renderPage();

      expect(screen.getByRole("button", { name: /Done/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Next/ })).not.toBeInTheDocument();
    });
  });

  describe("given the reviewer may not update annotations", () => {
    beforeEach(() => {
      mocks.canUpdateAnnotations = false;
    });

    /** @scenario "A reviewer who cannot update annotations is offered no correction" */
    it("offers no way to edit the trace, and keeps the rest of the bar", () => {
      renderPage();

      expect(screen.queryByRole("button", { name: /Edit trace/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(datasetCheckbox()).toBeInTheDocument();
    });
  });

  describe("when the reviewer chooses Edit trace", () => {
    /** @scenario "Edit trace uses the trace drawer in annotation mode" */
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

    /** @scenario "Edit trace uses the trace drawer in annotation mode" */
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

      /** @scenario "Edit trace uses the trace drawer in annotation mode" */
      it("opens the drawer on the summary tab instead", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByRole("button", { name: /Edit trace/ }));

        // The queue page already shows the conversation, so a second copy of
        // it in the drawer would say nothing new.
        expect(useDrawerStore.getState().viewMode).toBe("summary");
      });

      /** @scenario "Edit trace uses the trace drawer in annotation mode" */
      it("leaves the tab the reader gets elsewhere unchanged", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(screen.getByRole("button", { name: /Edit trace/ }));

        expect(localStorage.getItem(LAST_VIEW_MODE_KEY)).toBe("conversation");
      });
    });
  });

  describe("when turns are counted into the session", () => {
    /** @scenario "Reviewing and explicitly selecting traces builds the dataset set" */
    it("counts the open item's own trace before anything is annotated", () => {
      renderPage();

      expect(session().marks).toEqual({ "trace-1": "auto" });
      expect(datasetCheckbox("Add to dataset at the end (1 trace)")).toBeInTheDocument();
    });

    /** @scenario "Reviewing and explicitly selecting traces builds the dataset set" */
    it("leaves a turn the reviewer unticked out when the walk returns to it", () => {
      const view = renderPage();
      toggleTurn("trace-1");

      mocks.query = { "queue-item": "item-2" };
      view.rerender(page());
      mocks.query = { "queue-item": "item-1" };
      view.rerender(page());

      expect(session().marks["trace-1"]).toBe("off");
      expect(datasetCheckbox("Add to dataset at the end (1 trace)")).toBeInTheDocument();
    });

    /** @scenario "Reviewing and explicitly selecting traces builds the dataset set" */
    it("counts an annotated turn's trace on the bar's dataset toggle", () => {
      renderPage();
      expect(datasetCheckbox("Add to dataset at the end (1 trace)")).toBeInTheDocument();

      annotateTurn("trace-9");

      expect(datasetCheckbox("Add to dataset at the end (2 traces)")).toBeInTheDocument();
    });

    /** @scenario "Reviewing and explicitly selecting traces builds the dataset set" */
    it("counts a turn in by hand, and an untick wins over the annotation", () => {
      renderPage();

      toggleTurn("trace-2");
      expect(datasetCheckbox("Add to dataset at the end (2 traces)")).toBeInTheDocument();

      annotateTurn("trace-1");
      toggleTurn("trace-1");
      // The reviewer's own untick outranks the automatic count, so annotating
      // that turn again does not quietly put it back.
      annotateTurn("trace-1");

      expect(datasetCheckbox("Add to dataset at the end (1 trace)")).toBeInTheDocument();
    });

    /** @scenario "The dataset toggle reports usable selections" */
    it("carries the live count in traces on the toggle", () => {
      renderPage();

      annotateTurn("trace-2");
      annotateTurn("trace-3");
      expect(datasetCheckbox("Add to dataset at the end (3 traces)")).toBeInTheDocument();

      toggleTurn("trace-2");
      toggleTurn("trace-3");

      expect(datasetCheckbox("Add to dataset at the end (1 trace)")).toBeInTheDocument();
    });

    /** @scenario "The dataset toggle reports usable selections" */
    it("disables the dataset toggle once nothing is counted any more", async () => {
      const user = userEvent.setup();
      renderPage();

      toggleTurn("trace-1");

      const toggle = datasetCheckbox("Add to dataset at the end");
      expect(toggle).toBeDisabled();

      await user.click(toggle);

      expect(toggle).not.toBeChecked();
    });

    /** @scenario "Leaving clears the session selection" */
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

    /** @scenario "A selected hand-off remains over the conversation until it resolves" */
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

    /** @scenario "A selected hand-off remains over the conversation until it resolves" */
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

    /** @scenario "Completing or confirming without a dataset ends the session" */
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
    /** @scenario "Completing or confirming without a dataset ends the session" */
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

    /** @scenario "Completing or confirming without a dataset ends the session" */
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

    /** @scenario "Cancelling a hand-off leaves the final item and selections intact" */
    it("lands back on the conversation with nothing finished and every trace counted", async () => {
      const { user, view } = await finishQueueWithHandoff({
        traceIds: ["trace-1", "trace-2"],
      });

      mocks.openDrawers = [];
      view.rerender(page());
      await screen.findByText(END_SESSION_QUESTION);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByText(END_SESSION_QUESTION)).not.toBeInTheDocument());
      expect(screen.getByTestId("conversation-view")).toBeInTheDocument();
      expect(screen.queryByTestId("tasks-done")).not.toBeInTheDocument();
      expect(mocks.markDone).not.toHaveBeenCalled();
      expect(session().marks).toEqual({ "trace-1": "auto", "trace-2": "auto" });
    });

    /** @scenario "Cancelling a hand-off leaves the final item and selections intact" */
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
    /** @scenario "An unavailable trace can be skipped or removed" */
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

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("says the trace is no longer available and offers a way on", () => {
      renderPage();

      expect(screen.getByText("This trace is no longer available")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove from queue" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    });

<<<<<<< HEAD:apps/ui/src/features/annotation/ui/sections/__tests__/annotation-queue-walker-bar.integration.test.tsx
    /** @scenario "An unavailable trace can be skipped or removed" */
=======
    describe("when the reviewer has stepped on and the new item is still being read", () => {
      /** @scenario "Nothing acts on the item I have just stepped off" */
      it("holds the card's own actions, which sit outside the bar's cover", () => {
        // The card is drawn above the bar, in a different part of the page, so
        // the cover that holds the bar's buttons while the next item is read
        // cannot reach it. Where it lands next is read from the step in hand,
        // and that step is still the one being stepped off.
        mocks.stepIsStale = true;
        renderPage();

        expect(
          screen.getByRole("button", { name: "Remove from queue" }),
        ).toBeDisabled();
        expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
      });
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
>>>>>>> origin/main:platform/app/src/pages/[project]/annotations/__tests__/my-queue-bar.integration.test.tsx
    it("keeps the queue navigation and drops everything that acts on the trace", () => {
      renderPage();

      expect(screen.getByRole("button", { name: /Previous/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Next/ })).toBeInTheDocument();
      expect(screen.getByText("1 of 2")).toBeInTheDocument();

      expect(screen.queryByRole("button", { name: /Done/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Edit trace/ })).not.toBeInTheDocument();

      expect(
        screen.queryByRole("checkbox", { name: /Add to dataset at the end/ }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("moves on from the bar without finishing anything", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /Next/ }));

      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/my-queue?queue-item=item-2"),
      );

      expect(mocks.markDone).not.toHaveBeenCalled();
    });

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("removes the item and moves on to the next one", async () => {
      const user = userEvent.setup();

      mocks.deleteQueueItems.mockImplementation(
        (_input: unknown, options?: { onSuccess?: () => Promise<void> | void }) =>
          void options?.onSuccess?.(),
      );

      renderPage();

      await user.click(screen.getByRole("button", { name: "Remove from queue" }));

      expect(mocks.deleteQueueItems).toHaveBeenCalledWith(
        { projectId: "project-1", queueItemIds: ["item-1"] },
        expect.anything(),
      );

      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/my-queue?queue-item=item-2"),
      );

      await waitFor(() => expect(mocks.invalidateQueues).toHaveBeenCalled());
    });

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("moves on without taking the item out of the queue", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: "Skip" }));

      await waitFor(() =>
        expect(mocks.push).toHaveBeenCalledWith("/acme/annotations/my-queue?queue-item=item-2"),
      );

      expect(mocks.deleteQueueItems).not.toHaveBeenCalled();
    });

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("offers no removal to a reviewer who may not update annotations", () => {
      mocks.canUpdateAnnotations = false;
      renderPage();

      expect(screen.queryByRole("button", { name: "Remove from queue" })).not.toBeInTheDocument();
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

    /** @scenario "An unavailable trace can be skipped or removed" */
    it("reads as a finished queue", async () => {
      renderPage();

      expect(await screen.findByTestId("tasks-done")).toBeInTheDocument();
    });
  });

  describe("when the reviewer leaves right after moving to the next item", () => {
    /** @scenario "Navigation does not leave work after the page" */
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
