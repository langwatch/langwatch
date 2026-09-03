/**
 * @vitest-environment jsdom
 *
 * Reviewers curate in the annotations list, send what they judged straight to a
 * dataset, and take what nobody can review out of the queue.
 *
 * MOVED from
 * `platform/app/src/components/annotations/__tests__/AnnotationsTable.selection.integration.test.tsx`.
 * What changed is which modules are mocked and how an overlay is observed —
 * `openDrawer(...)` calls are query writes now, so the assertions read the
 * host's recorded address instead of a spy on the application's registry. What
 * is asserted is the same, scenario for scenario.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnnotationTestHarness,
  StubAnnotationHost,
  type StubAnnotationHostOptions,
} from "../../../testing";

type QueueItem = { id: string; traceId: string; doneAt: Date | null };

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  requestEnable: vi.fn<() => Promise<boolean>>(),
  deleteMutate: vi.fn(),
  deleteOptions: null as { onSuccess?: (result: { deleted: number }) => void } | null,
  createQueueItemMutate: vi.fn(),
  createQueueItemOptions: null as {
    onSuccess?: (result: { created: number; skipped: number }) => void;
  } | null,
  pickedAnnotators: [] as { id: string; name: string }[],
  invalidateQueues: vi.fn(),
}));

vi.mock("../../../behavior/use-annotation-queues", () => ({
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    queuesLoading: false,
  }),
}));

vi.mock("../../../behavior/annotation-api", () => ({
  annotationApi: {
    useUtils: () => ({
      annotation: {
        getOptimizedAnnotationQueues: { invalidate: mocks.invalidateQueues },
        getPendingItemsCount: { invalidate: vi.fn() },
        getAssignedItemsCount: { invalidate: vi.fn() },
        getQueueItemsCounts: { invalidate: vi.fn() },
      },
      personalWorkspaceFeatures: { get: { invalidate: vi.fn() } },
    }),
    annotationScore: { getAll: { useQuery: () => ({ data: [] }) } },
    project: {
      getFieldRedactionStatus: {
        useQuery: () => ({
          data: {
            isRedacted: { input: false, output: false },
            visibleTo: { input: null, output: null },
          },
          isLoading: false,
        }),
      },
    },
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: { datasets: true } }) },
      enableAll: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: [] } }),
      },
    },
    annotation: {
      deleteQueueItems: {
        useMutation: (options: { onSuccess?: (result: { deleted: number }) => void }) => {
          mocks.deleteOptions = options;
          return { mutate: mocks.deleteMutate, isPending: false };
        },
      },
      getQueues: {
        useQuery: () => ({
          data: [
            { id: "q1", name: "Support reviews", slug: "support-reviews" },
            { id: "q2", name: "Sales reviews", slug: "sales-reviews" },
          ],
        }),
      },
      createQueueItem: {
        useMutation: (options: {
          onSuccess?: (result: { created: number; skipped: number }) => void;
        }) => {
          mocks.createQueueItemOptions = options;
          return { mutate: mocks.createQueueItemMutate, isPending: false };
        },
      },
    },
  },
}));

// The dataset gate has its own suite; here it only has to answer.
vi.mock("../../../behavior/use-personal-feature-gate", () => ({
  usePersonalDatasetGate: () => ({
    isGated: false,
    requestEnable: mocks.requestEnable,
    dialogState: { open: false, onConfirm: vi.fn(), onCancel: vi.fn(), isEnabling: false },
  }),
}));

// The participants picker is a Chakra multi-select the dialog only composes.
// The stub keeps the contract the list depends on (who the picker opens on, who
// it sends to) without driving Ark's select in jsdom.
vi.mock("../../blocks/queue-participants", () => ({
  QueueParticipants: ({
    annotators,
    setAnnotators,
    onSend,
    onCreateQueue,
  }: {
    annotators: { id: string; name: string }[];
    setAnnotators: (annotators: { id: string; name: string }[]) => void;
    onSend: () => void;
    onCreateQueue: () => void;
  }) => (
    <div>
      <div data-testid="picked-annotators">
        {annotators.map((annotator) => annotator.id).join(",")}
      </div>
      <button type="button" onClick={() => setAnnotators(mocks.pickedAnnotators)}>
        Pick participants
      </button>
      <button type="button" onClick={onCreateQueue}>
        Add New Queue
      </button>
      <button type="button" disabled={annotators.length === 0} onClick={onSend}>
        Send
      </button>
    </div>
  ),
}));

const { AnnotationList } = await import("../annotation-list");
const { groupedAnnotationsToRows } = await import("../../../model/annotation-row");

type ListProps = Omit<Parameters<typeof AnnotationList>[0], "host">;

const setItems = (items: QueueItem[]) => {
  mocks.items = items.map((item) => ({
    ...item,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    createdByUser: null,
    annotations: [],
    trace: undefined,
  }));
};

/**
 * The list reads its project, its grants and the address off the host, so a
 * test hands it one rather than mocking four application hooks.
 */
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
    /** Re-renders on a NEW host, which is how the address changes under it. */
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

/** The Inbox: rows from every queue the reviewer is on. */
const renderInbox = () => renderList({ view: "inbox" });

/** The named queue page: the page IS one queue, which its rows sit on. */
const renderQueuePage = () =>
  renderList({
    view: "queue",
    queueId: "q1",
    pageQueue: { annotatorId: "queue-q1", name: "Support reviews" },
  });

const renderAllAnnotations = () =>
  renderList({
    view: "all",
    rows: groupedAnnotationsToRows([
      { traceId: "trace-1", annotations: [] },
      { traceId: "trace-2", annotations: [] },
    ]),
  });

const pickedAnnotators = () => screen.getByTestId("picked-annotators");

/** Replaces whoever the picker opened on, then confirms. */
const pickAndSend = (annotators: { id: string; name: string }[]) => {
  mocks.pickedAnnotators = annotators;
  fireEvent.click(screen.getByRole("button", { name: "Pick participants" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

const rowCheckbox = (traceId: string) =>
  screen.getByRole("checkbox", { name: `Select trace ${traceId}` });

const headerCheckbox = () => screen.getByRole("checkbox", { name: "Select all on this page" });

const selectionBar = () => screen.queryByTestId("annotations-selection-bar");

const lastAddress = (host: StubAnnotationHost) => host.lastQuery;

beforeEach(() => {
  mocks.deleteMutate.mockReset();
  mocks.deleteOptions = null;
  mocks.pickedAnnotators = [];
  mocks.createQueueItemOptions = null;
  mocks.createQueueItemMutate.mockReset();
  mocks.createQueueItemMutate.mockImplementation(() => {
    mocks.createQueueItemOptions?.onSuccess?.({ created: 2, skipped: 0 });
  });
  mocks.invalidateQueues.mockClear();
  mocks.requestEnable.mockReset();
  mocks.requestEnable.mockResolvedValue(true);
  setItems([
    { id: "item-1", traceId: "trace-1", doneAt: null },
    { id: "item-2", traceId: "trace-2", doneAt: null },
    { id: "item-3", traceId: "trace-3", doneAt: null },
  ]);
});
afterEach(cleanup);

describe("given the annotations list shows rows", () => {
  /** @scenario "Rows are selected independently" */
  it("puts a checkbox on every row and a select-all in the header", () => {
    renderInbox();

    expect(headerCheckbox()).toBeInTheDocument();
    expect(rowCheckbox("trace-1")).toBeInTheDocument();
    expect(rowCheckbox("trace-2")).toBeInTheDocument();
    expect(rowCheckbox("trace-3")).toBeInTheDocument();

    // Leading column: the checkbox is the first cell of its row.
    const firstCell = rowCheckbox("trace-1").closest("td");
    expect(firstCell).toBe(firstCell?.parentElement?.firstElementChild);
  });

  /** @scenario "A changed result set clears selection" */
  it("hides the selection bar until something is picked", () => {
    renderInbox();

    expect(selectionBar()).not.toBeInTheDocument();
  });

  describe("when the user ticks a row checkbox", () => {
    /** @scenario "Rows are selected independently" */
    it("selects the row without navigating away", () => {
      const { host } = renderInbox();

      fireEvent.click(rowCheckbox("trace-1"));

      expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "true");
      expect(host.navigations).toEqual([]);
      expect(host.queries).toEqual([]);
    });
  });

  describe("when the user ticks the header checkbox", () => {
    /** @scenario "Rows are selected independently" */
    it("selects every row on the page", () => {
      renderInbox();

      fireEvent.click(headerCheckbox());

      expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "true");
      expect(rowCheckbox("trace-2")).toHaveAttribute("aria-checked", "true");
      expect(rowCheckbox("trace-3")).toHaveAttribute("aria-checked", "true");
      expect(selectionBar()).toHaveTextContent("3 selected");
    });

    /** @scenario "Rows are selected independently" */
    it("clears the page when everything is already selected", () => {
      renderInbox();

      fireEvent.click(headerCheckbox());
      fireEvent.click(headerCheckbox());

      expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "false");
      expect(selectionBar()).not.toBeInTheDocument();
    });
  });

  describe("when two rows were queued for the same trace", () => {
    /** @scenario "Rows are selected independently" */
    it("counts both rows", () => {
      setItems([
        { id: "item-1", traceId: "trace-1", doneAt: null },
        { id: "item-2", traceId: "trace-1", doneAt: null },
        { id: "item-3", traceId: "trace-2", doneAt: null },
      ]);
      renderInbox();

      fireEvent.click(headerCheckbox());

      expect(selectionBar()).toHaveTextContent("3 selected");
    });

    /** @scenario "Dataset hand-off deduplicates selected traces" */
    it("hands the shared trace to the dataset once", async () => {
      setItems([
        { id: "item-1", traceId: "trace-1", doneAt: null },
        { id: "item-2", traceId: "trace-1", doneAt: null },
      ]);
      const { host } = renderInbox();

      fireEvent.click(headerCheckbox());
      fireEvent.click(screen.getAllByRole("button", { name: /Add to dataset/ })[0]!);

      await vi.waitFor(() =>
        expect(lastAddress(host)).toMatchObject({
          "drawer.open": "addDatasetRecord",
          "drawer.selectedTraceIds": "trace-1",
        }),
      );
    });
  });

  describe("when the reviewer moves to another page", () => {
    /** @scenario "A changed result set clears selection" */
    it("drops the selection", () => {
      const view = renderInbox();

      fireEvent.click(rowCheckbox("trace-1"));
      expect(selectionBar()).toBeInTheDocument();

      view.onAddress({ route: { params: {}, query: { pageOffset: "25" } } });

      expect(selectionBar()).not.toBeInTheDocument();
    });
  });

  describe("when the reviewer switches the status filter", () => {
    /** @scenario "A changed result set clears selection" */
    it("drops the selection", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderInbox();

      fireEvent.click(rowCheckbox("trace-1"));
      expect(selectionBar()).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Status/ }));
      await user.click(await screen.findByText("Completed"));

      await vi.waitFor(() => expect(selectionBar()).not.toBeInTheDocument());
    });
  });
});

describe("given rows are selected", () => {
  /** @scenario "Dataset hand-off deduplicates selected traces" */
  it("shows the count and offers Add to dataset", () => {
    renderInbox();

    fireEvent.click(rowCheckbox("trace-1"));
    fireEvent.click(rowCheckbox("trace-2"));

    expect(selectionBar()).toHaveTextContent("2 selected");
    expect(screen.getAllByRole("button", { name: /Add to dataset/ }).length).toBeGreaterThan(0);
  });

  /** @scenario "Queue removal is available only for queue items" */
  it("offers to remove the picked items from the queue", () => {
    renderInbox();

    fireEvent.click(rowCheckbox("trace-1"));

    expect(selectionBar()).toHaveTextContent("Remove from queue");
  });

  describe("when the user clicks Add to dataset", () => {
    /** @scenario "Dataset hand-off deduplicates selected traces" */
    it("writes the dataset drawer address with the selected trace ids", async () => {
      const { host } = renderInbox();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(rowCheckbox("trace-3"));
      fireEvent.click(screen.getAllByRole("button", { name: /Add to dataset/ })[0]!);

      await vi.waitFor(() =>
        expect(lastAddress(host)).toMatchObject({
          "drawer.open": "addDatasetRecord",
          "drawer.selectedTraceIds": "trace-1,trace-3",
        }),
      );
    });
  });

  describe("when the user removes the selection from the queue", () => {
    /** @scenario "Queue removal is available only for queue items" */
    it("removes exactly the picked queue items and clears the selection", () => {
      renderInbox();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(rowCheckbox("trace-3"));
      fireEvent.click(screen.getByRole("button", { name: /Remove from queue/ }));

      expect(mocks.deleteMutate).toHaveBeenCalledWith({
        projectId: "proj-1",
        queueItemIds: ["item-1", "item-3"],
      });

      act(() => {
        mocks.deleteOptions?.onSuccess?.({ deleted: 2 });
      });

      expect(selectionBar()).not.toBeInTheDocument();
      expect(mocks.invalidateQueues).toHaveBeenCalled();
    });
  });
});

describe("given rows on the all annotations page are selected", () => {
  /** @scenario "Queue removal is available only for queue items" */
  it("offers no remove-from-queue action", () => {
    renderAllAnnotations();

    fireEvent.click(headerCheckbox());

    expect(selectionBar()).toHaveTextContent("2 selected");
    expect(selectionBar()).not.toHaveTextContent("Remove from queue");
  });

  /** @scenario "Queue actions respect the page's queue context" */
  it("offers to add the selection to a queue", () => {
    renderAllAnnotations();

    fireEvent.click(headerCheckbox());

    expect(selectionBar()).toHaveTextContent("Add to queue");
    expect(selectionBar()).not.toHaveTextContent("Move to queue");
  });

  describe("when the user chooses to add the selection to a queue", () => {
    /** @scenario "Queue actions respect the page's queue context" */
    it("opens the queue dialog with nothing preselected", () => {
      renderAllAnnotations();

      fireEvent.click(headerCheckbox());
      fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));

      expect(screen.getByText("Add to annotation queue")).toBeInTheDocument();
      expect(pickedAnnotators()).toBeEmptyDOMElement();
    });

    /** @scenario "Queue actions respect the page's queue context" */
    it("sends the selected traces to the chosen queue", () => {
      renderAllAnnotations();

      fireEvent.click(headerCheckbox());
      fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
      pickAndSend([{ id: "queue-q2", name: "Sales reviews" }]);

      expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
        projectId: "proj-1",
        traceIds: ["trace-1", "trace-2"],
        annotators: ["queue-q2"],
      });
      expect(mocks.deleteMutate).not.toHaveBeenCalled();
    });

    it("confirms with a way into wherever the traces landed", () => {
      const { host } = renderAllAnnotations();

      fireEvent.click(headerCheckbox());
      fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
      pickAndSend([{ id: "queue-q2", name: "Sales reviews" }]);

      const notice = host.successes.at(-1);
      expect(notice?.title).toBe("Added to annotation queue");
      expect(notice?.action?.label).toBe("View queue");
      act(() => notice?.action?.perform());
      expect(host.navigations).toContain("/test-project/annotations/sales-reviews");
    });
  });
});

describe("given rows on a queue page are selected", () => {
  /** @scenario "Queue actions respect the page's queue context" */
  it("offers to move the selection and not to add it", () => {
    renderQueuePage();

    fireEvent.click(rowCheckbox("trace-1"));

    expect(selectionBar()).toHaveTextContent("Move to queue");
    expect(selectionBar()).not.toHaveTextContent("Add to queue");
  });

  /** @scenario "Queue actions respect the page's queue context" */
  it("opens the queue dialog on the queue this page is", () => {
    renderQueuePage();

    fireEvent.click(rowCheckbox("trace-1"));
    fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));

    expect(pickedAnnotators()).toHaveTextContent("queue-q1");
  });

  describe("when the user deselects this queue, picks another and confirms", () => {
    /** @scenario "Queue actions respect the page's queue context" */
    it("queues the traces elsewhere and takes their items off this queue", () => {
      renderQueuePage();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(rowCheckbox("trace-3"));
      fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));
      pickAndSend([{ id: "queue-q2", name: "Sales reviews" }]);

      expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
        projectId: "proj-1",
        traceIds: ["trace-1", "trace-3"],
        annotators: ["queue-q2"],
      });
      expect(mocks.deleteMutate).toHaveBeenCalledWith({
        projectId: "proj-1",
        queueItemIds: ["item-1", "item-3"],
      });
    });
  });

  describe("when the user keeps this queue selected and adds another", () => {
    /** @scenario "Queue actions respect the page's queue context" */
    it("queues the traces elsewhere and leaves their items on this queue", () => {
      renderQueuePage();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));
      pickAndSend([
        { id: "queue-q1", name: "Support reviews" },
        { id: "queue-q2", name: "Sales reviews" },
      ]);

      expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
        projectId: "proj-1",
        traceIds: ["trace-1"],
        annotators: ["queue-q1", "queue-q2"],
      });
      expect(mocks.deleteMutate).not.toHaveBeenCalled();
    });
  });

  describe("when the reviewer creates a queue from inside the send dialog", () => {
    /**
     * `platform/app` mounted the create-queue drawer from inside the dialog.
     * Here the dialog writes this family's own address and the screen above
     * mounts the editor, so the dialog does not have to know a queue can be
     * created at all.
     */
    it("writes the queue editor address rather than mounting a drawer", () => {
      const { host } = renderQueuePage();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));
      fireEvent.click(screen.getByRole("button", { name: "Add New Queue" }));

      expect(lastAddress(host)).toMatchObject({ "queue-editor": "new" });
    });
  });
});
