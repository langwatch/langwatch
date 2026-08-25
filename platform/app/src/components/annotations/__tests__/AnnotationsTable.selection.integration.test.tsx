/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * Reviewers curate in the annotations list, send what they judged straight to a
 * dataset, and take what nobody can review out of the queue.
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

type QueueItem = {
  id: string;
  traceId: string;
  doneAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  // One object for the whole file: the real hook memoizes its period, and a
  // fresh Date per render would make anything keyed on it churn.
  period: {
    startDate: new Date("2026-07-09T00:00:00Z"),
    endDate: new Date("2026-08-08T00:00:00Z"),
  },
  items: [] as unknown[],
  query: {} as Record<string, string>,
  openDrawer: vi.fn(),
  push: vi.fn(),
  requestEnable: vi.fn<() => Promise<boolean>>(),
  deleteMutate: vi.fn(),
  deleteOptions: null as {
    onSuccess?: (result: { deleted: number }) => void;
  } | null,
  createQueueItemMutate: vi.fn(),
  createQueueItemOptions: null as {
    onSuccess?: (result: { created: number; skipped: number }) => void;
  } | null,
  pickedAnnotators: [] as { id: string; name: string }[],
  invalidateQueues: vi.fn(),
  invalidatePending: vi.fn(),
  invalidateAssigned: vi.fn(),
  invalidateQueueCounts: vi.fn(),
  toastCreate: vi.fn(),
}));

vi.mock("~/hooks/useAnnotationQueues", () => ({
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    queuesLoading: false,
  }),
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
        getOptimizedAnnotationQueues: { invalidate: mocks.invalidateQueues },
        getPendingItemsCount: { invalidate: mocks.invalidatePending },
        getAssignedItemsCount: { invalidate: mocks.invalidateAssigned },
        getQueueItemsCounts: { invalidate: mocks.invalidateQueueCounts },
      },
    }),
    annotationScore: {
      getAll: { useQuery: () => ({ data: [] }) },
    },
    annotation: {
      deleteQueueItems: {
        useMutation: (options: { onSuccess?: (result: { deleted: number }) => void }) => {
          mocks.deleteOptions = options;
          return { mutate: mocks.deleteMutate, isLoading: false };
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
          return { mutate: mocks.createQueueItemMutate, isLoading: false };
        },
      },
    },
  },
}));
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "me" } } }),
}));
vi.mock("~/components/AddAnnotationQueueDrawer", () => ({
  AddAnnotationQueueDrawer: () => null,
}));
// The participants picker is a Chakra multi-select the dialog only composes.
// The stub keeps the contract the table depends on (who the picker opens on,
// who it sends to) without driving Ark's select in jsdom.
vi.mock("~/components/traces/AddParticipants", () => ({
  AddParticipants: ({
    annotators,
    setAnnotators,
    sendToQueue,
  }: {
    annotators: { id: string; name: string }[];
    setAnnotators: (annotators: { id: string; name: string }[]) => void;
    sendToQueue?: () => void;
  }) => (
    <div>
      <div data-testid="picked-annotators">
        {annotators.map((annotator) => annotator.id).join(",")}
      </div>
      <button type="button" onClick={() => setAnnotators(mocks.pickedAnnotators)}>
        Pick participants
      </button>
      <button type="button" disabled={annotators.length === 0} onClick={sendToQueue}>
        Send
      </button>
    </div>
  ),
}));
vi.mock("~/components/PeriodSelector", () => ({
  PeriodSelector: () => null,
  usePeriodSelector: () => ({
    period: mocks.period,
    mode: "relative",
    isDefault: true,
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
  }),
}));
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mocks.toastCreate },
}));
vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));
vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("~/components/ui/RedactedField", () => ({
  RedactedField: ({ children }: { children: ReactNode }) => <>{children}</>,
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

import { AnnotationsTable, type AnnotationsTableProps } from "../AnnotationsTable";
import { groupedAnnotationsToRows } from "@langwatch/annotation-web";

const setItems = (items: QueueItem[]) => {
  mocks.items = items.map((item) => ({
    ...item,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    createdByUser: null,
    annotations: [],
    trace: undefined,
  }));
};

const queueTable = (props: Partial<AnnotationsTableProps> = {}) => (
  <ChakraProvider value={defaultSystem}>
    <AnnotationsTable
      heading="Annotations"
      dateColumnLabel="Date queued"
      showStatusFilter={true}
      rowTarget="queueItem"
      {...props}
    />
  </ChakraProvider>
);

const renderTable = (props: Partial<AnnotationsTableProps> = {}) =>
  render(queueTable(props));

/** The named queue page: the page is one queue, which its rows sit on. */
const renderQueuePage = () =>
  renderTable({
    queueId: "q1",
    pageQueue: { annotatorId: "queue-q1", name: "Support reviews" },
  });

const renderAllAnnotationsPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationsTable
        heading="All Annotations"
        dateColumnLabel="Date annotated"
        showStatusFilter={false}
        rowTarget="trace"
        rows={groupedAnnotationsToRows([
          { traceId: "trace-1", annotations: [] },
          { traceId: "trace-2", annotations: [] },
        ])}
      />
    </ChakraProvider>,
  );

const pickedAnnotators = () => screen.getByTestId("picked-annotators");

/** Replaces whoever the picker opened on, then confirms. */
const pickAndSend = (annotators: { id: string; name: string }[]) => {
  mocks.pickedAnnotators = annotators;
  fireEvent.click(screen.getByRole("button", { name: "Pick participants" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

const rowCheckbox = (traceId: string) =>
  screen.getByRole("checkbox", { name: `Select trace ${traceId}` });

const headerCheckbox = () =>
  screen.getByRole("checkbox", { name: "Select all on this page" });

const selectionBar = () => screen.queryByTestId("annotations-selection-bar");

beforeEach(() => {
  mocks.openDrawer.mockClear();
  mocks.push.mockClear();
  mocks.query = {};
  mocks.deleteMutate.mockReset();
  mocks.deleteOptions = null;
  mocks.pickedAnnotators = [];
  mocks.createQueueItemOptions = null;
  mocks.createQueueItemMutate.mockReset();
  mocks.createQueueItemMutate.mockImplementation(() => {
    mocks.createQueueItemOptions?.onSuccess?.({ created: 2, skipped: 0 });
  });
  mocks.toastCreate.mockClear();
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

describe("AnnotationsTable selection", () => {
  describe("given the annotations list shows rows", () => {
    /** @scenario "Every row carries a checkbox in a leading column" */
    it("puts a checkbox on every row and a select-all in the header", () => {
      renderTable();

      expect(headerCheckbox()).toBeInTheDocument();
      expect(rowCheckbox("trace-1")).toBeInTheDocument();
      expect(rowCheckbox("trace-2")).toBeInTheDocument();
      expect(rowCheckbox("trace-3")).toBeInTheDocument();

      // Leading column: the checkbox is the first cell of its row.
      const firstCell = rowCheckbox("trace-1").closest("td");
      expect(firstCell).toBe(firstCell?.parentElement?.firstElementChild);
    });

    /** @scenario "The selection bar is hidden while nothing is selected" */
    it("hides the selection bar until something is picked", () => {
      renderTable();

      expect(selectionBar()).not.toBeInTheDocument();
    });

    describe("when the user ticks a row checkbox", () => {
      /** @scenario "Ticking a row checkbox does not open the row" */
      it("selects the row without navigating away", () => {
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));

        expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "true");
        expect(mocks.push).not.toHaveBeenCalled();
        expect(mocks.openDrawer).not.toHaveBeenCalled();
      });
    });

    describe("when the user ticks the header checkbox", () => {
      /** @scenario "The header checkbox selects every row on the page" */
      it("selects every row on the page", () => {
        renderTable();

        fireEvent.click(headerCheckbox());

        expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "true");
        expect(rowCheckbox("trace-2")).toHaveAttribute("aria-checked", "true");
        expect(rowCheckbox("trace-3")).toHaveAttribute("aria-checked", "true");
        expect(selectionBar()).toHaveTextContent("3 selected");
      });

      /** @scenario "The header checkbox clears a fully selected page" */
      it("clears the page when everything is already selected", () => {
        renderTable();

        fireEvent.click(headerCheckbox());
        fireEvent.click(headerCheckbox());

        expect(rowCheckbox("trace-1")).toHaveAttribute("aria-checked", "false");
        expect(selectionBar()).not.toBeInTheDocument();
      });
    });

    describe("when two rows were queued for the same trace", () => {
      /** @scenario "Two rows queued for the same trace are picked separately" */
      it("counts both rows", () => {
        setItems([
          { id: "item-1", traceId: "trace-1", doneAt: null },
          { id: "item-2", traceId: "trace-1", doneAt: null },
          { id: "item-3", traceId: "trace-2", doneAt: null },
        ]);
        renderTable();

        fireEvent.click(headerCheckbox());

        expect(selectionBar()).toHaveTextContent("3 selected");
      });

      /** @scenario "Add to dataset counts a trace shared by two rows once" */
      it("hands the shared trace to the dataset once", async () => {
        setItems([
          { id: "item-1", traceId: "trace-1", doneAt: null },
          { id: "item-2", traceId: "trace-1", doneAt: null },
        ]);
        renderTable();

        fireEvent.click(headerCheckbox());
        fireEvent.click(screen.getAllByRole("button", { name: /Add to dataset/ })[0]!);

        await vi.waitFor(() =>
          expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
            selectedTraceIds: ["trace-1"],
          }),
        );
      });
    });

    describe("when the reviewer moves to another page", () => {
      /** @scenario "Moving to another page clears the selection" */
      it("drops the selection", () => {
        const view = renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        expect(selectionBar()).toBeInTheDocument();

        mocks.query = { pageOffset: "25" };
        view.rerender(queueTable());

        expect(selectionBar()).not.toBeInTheDocument();
      });
    });

    describe("when the reviewer switches the status filter", () => {
      /** @scenario "Changing the status filter clears the selection" */
      it("drops the selection", async () => {
        const user = userEvent.setup({ pointerEventsCheck: 0 });
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        expect(selectionBar()).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /Status/ }));
        await user.click(await screen.findByText("Completed"));

        await vi.waitFor(() => expect(selectionBar()).not.toBeInTheDocument());
      });
    });
  });

  describe("given rows are selected", () => {
    /** @scenario "The selection bar appears with the count and the actions" */
    it("shows the count and offers Add to dataset", () => {
      renderTable();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(rowCheckbox("trace-2"));

      expect(selectionBar()).toHaveTextContent("2 selected");
      expect(
        screen.getAllByRole("button", { name: /Add to dataset/ }).length,
      ).toBeGreaterThan(0);
    });

    /** @scenario "The selection bar offers to remove the selected items from the queue" */
    it("offers to remove the picked items from the queue", () => {
      renderTable();

      fireEvent.click(rowCheckbox("trace-1"));

      expect(selectionBar()).toHaveTextContent("Remove from queue");
    });

    describe("when the user clicks Add to dataset", () => {
      /** @scenario "Add to dataset opens the dataset drawer with the selected traces" */
      it("opens the dataset drawer with the selected trace ids", async () => {
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(rowCheckbox("trace-3"));
        fireEvent.click(screen.getAllByRole("button", { name: /Add to dataset/ })[0]!);

        await vi.waitFor(() =>
          expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
            selectedTraceIds: ["trace-1", "trace-3"],
          }),
        );
      });

      /** @scenario "Add to dataset waits for the personal workspace to allow datasets" */
      it("does not open the drawer when the datasets gate is declined", async () => {
        // The gate is answered by hand so the assertion runs after the handler
        // resumed from it, rather than on whichever tick came first.
        let decline: (allowed: boolean) => void = () => undefined;
        mocks.requestEnable.mockReturnValue(
          new Promise<boolean>((resolve) => {
            decline = resolve;
          }),
        );
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(screen.getAllByRole("button", { name: /Add to dataset/ })[0]!);

        await vi.waitFor(() => expect(mocks.requestEnable).toHaveBeenCalled());
        await act(async () => {
          decline(false);
        });

        expect(mocks.openDrawer).not.toHaveBeenCalled();
      });
    });

    describe("when the user removes the selection from the queue", () => {
      /** @scenario "Removing the selection takes exactly those queue items out" */
      it("removes exactly the picked queue items and clears the selection", () => {
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(rowCheckbox("trace-3"));
        fireEvent.click(screen.getByRole("button", { name: /Remove from queue/ }));

        expect(mocks.deleteMutate).toHaveBeenCalledWith({
          projectId: "project-1",
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
    /** @scenario "The all annotations page never offers to remove from a queue" */
    it("offers no remove-from-queue action", () => {
      renderAllAnnotationsPage();

      fireEvent.click(headerCheckbox());

      expect(selectionBar()).toHaveTextContent("2 selected");
      expect(selectionBar()).not.toHaveTextContent("Remove from queue");
    });

    /** @scenario "The all annotations page offers to add the selection to a queue" */
    it("offers to add the selection to a queue", () => {
      renderAllAnnotationsPage();

      fireEvent.click(headerCheckbox());

      expect(selectionBar()).toHaveTextContent("Add to queue");
      expect(selectionBar()).not.toHaveTextContent("Move to queue");
    });

    describe("when the user chooses to add the selection to a queue", () => {
      /** @scenario "The all annotations page offers to add the selection to a queue" */
      it("opens the queue dialog with nothing preselected", () => {
        renderAllAnnotationsPage();

        fireEvent.click(headerCheckbox());
        fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));

        expect(screen.getByText("Add to annotation queue")).toBeInTheDocument();
        expect(pickedAnnotators()).toBeEmptyDOMElement();
      });

      /** @scenario "The all annotations page offers to add the selection to a queue" */
      it("sends the selected traces to the chosen queue", () => {
        renderAllAnnotationsPage();

        fireEvent.click(headerCheckbox());
        fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
        pickAndSend([{ id: "queue-q2", name: "Sales reviews" }]);

        expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["trace-1", "trace-2"],
          annotators: ["queue-q2"],
        });
        expect(mocks.deleteMutate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given rows on a queue page are selected", () => {
    /** @scenario "A queue page offers to move the selection instead" */
    it("offers to move the selection and not to add it", () => {
      renderQueuePage();

      fireEvent.click(rowCheckbox("trace-1"));

      expect(selectionBar()).toHaveTextContent("Move to queue");
      expect(selectionBar()).not.toHaveTextContent("Add to queue");
    });

    /** @scenario "A queue page offers to move the selection instead" */
    it("opens the queue dialog on the queue this page is", () => {
      renderQueuePage();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));

      expect(pickedAnnotators()).toHaveTextContent("queue-q1");
    });

    describe("when the user deselects this queue, picks another and confirms", () => {
      /** @scenario "Moving the selection re-queues it and leaves this queue" */
      it("queues the traces elsewhere and takes their items off this queue", () => {
        renderQueuePage();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(rowCheckbox("trace-3"));
        fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));
        pickAndSend([{ id: "queue-q2", name: "Sales reviews" }]);

        expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["trace-1", "trace-3"],
          annotators: ["queue-q2"],
        });
        expect(mocks.deleteMutate).toHaveBeenCalledWith({
          projectId: "project-1",
          queueItemIds: ["item-1", "item-3"],
        });
      });
    });

    describe("when the user keeps this queue selected and adds another", () => {
      /** @scenario "Keeping this queue selected adds without removing" */
      it("queues the traces elsewhere and leaves their items on this queue", () => {
        renderQueuePage();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(screen.getByRole("button", { name: /Move to queue/ }));
        pickAndSend([
          { id: "queue-q1", name: "Support reviews" },
          { id: "queue-q2", name: "Sales reviews" },
        ]);

        expect(mocks.createQueueItemMutate).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["trace-1"],
          annotators: ["queue-q1", "queue-q2"],
        });
        expect(mocks.deleteMutate).not.toHaveBeenCalled();
      });
    });
  });
});
