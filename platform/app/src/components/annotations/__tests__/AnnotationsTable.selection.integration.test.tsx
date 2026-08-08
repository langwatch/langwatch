/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * Reviewers curate in the annotations list, send what they judged straight to a
 * dataset, and take what nobody can review out of the queue.
 * Spec: specs/annotations/annotations-list-selection.feature.
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
        useMutation: (options: {
          onSuccess?: (result: { deleted: number }) => void;
        }) => {
          mocks.deleteOptions = options;
          return { mutate: mocks.deleteMutate, isLoading: false };
        },
      },
    },
  },
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

import { AnnotationsTable } from "../AnnotationsTable";
import { groupedAnnotationsToRows } from "../annotationRow";

const setItems = (items: QueueItem[]) => {
  mocks.items = items.map((item) => ({
    ...item,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    createdByUser: null,
    annotations: [],
    trace: undefined,
  }));
};

const queueTable = () => (
  <ChakraProvider value={defaultSystem}>
    <AnnotationsTable
      heading="Annotations"
      dateColumnLabel="Date queued"
      showStatusFilter={true}
      rowTarget="queueItem"
    />
  </ChakraProvider>
);

const renderTable = () => render(queueTable());

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
        fireEvent.click(
          screen.getAllByRole("button", { name: /Add to dataset/ })[0]!,
        );

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
        fireEvent.click(
          screen.getAllByRole("button", { name: /Add to dataset/ })[0]!,
        );

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
        fireEvent.click(
          screen.getAllByRole("button", { name: /Add to dataset/ })[0]!,
        );

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
        fireEvent.click(
          screen.getByRole("button", { name: /Remove from queue/ }),
        );

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

      fireEvent.click(headerCheckbox());

      expect(selectionBar()).toHaveTextContent("2 selected");
      expect(selectionBar()).not.toHaveTextContent("Remove from queue");
    });
  });
});
