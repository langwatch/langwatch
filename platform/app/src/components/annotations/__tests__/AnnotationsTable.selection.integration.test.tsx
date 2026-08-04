/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * Reviewers curate in the annotations list and send what they judged straight
 * to a dataset, without a CSV detour.
 * Spec: specs/annotations/annotations-list-selection.feature.
 */

type QueueItem = {
  id: string;
  traceId: string;
  doneAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  items: [] as {
    id: string;
    traceId: string;
    doneAt: Date | null;
    createdAt: Date;
    createdByUser: null;
    annotations: never[];
    trace: undefined;
  }[],
  pageOffset: 0,
  openDrawer: vi.fn(),
  push: vi.fn(),
  gateAllows: true,
}));

vi.mock("~/hooks/useAnnotationQueues", () => ({
  useAnnotationQueues: () => ({
    assignedQueueItems: mocks.items,
    totalCount: mocks.items.length,
    scoreOptions: { data: [] },
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
  useRouter: () => ({ push: mocks.push, query: {} }),
}));
vi.mock("~/components/NavigationFooter", () => ({
  NavigationFooter: () => null,
  useNavigationFooter: () => ({
    pageOffset: mocks.pageOffset,
    pageSize: 25,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    changePageSize: vi.fn(),
  }),
}));
vi.mock("~/features/traces-v2/components/TraceIdPeek", () => ({
  TraceIdPeek: () => null,
}));
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
    requestEnable: async () => mocks.gateAllows,
    dialogState: { open: false },
  }),
}));

import { AnnotationsTable } from "../AnnotationsTable";

const setItems = (items: QueueItem[]) => {
  mocks.items = items.map((item) => ({
    ...item,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    createdByUser: null,
    annotations: [],
    trace: undefined,
  }));
};

const renderTable = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationsTable heading="Annotations" />
    </ChakraProvider>,
  );

const rowCheckbox = (traceId: string) =>
  screen.getByRole("button", { name: `Select trace ${traceId}` });

const headerCheckbox = () =>
  screen.getByRole("button", { name: "Select all on this page" });

const selectionBar = () => screen.queryByTestId("annotations-selection-bar");

beforeEach(() => {
  mocks.openDrawer.mockClear();
  mocks.push.mockClear();
  mocks.pageOffset = 0;
  mocks.gateAllows = true;
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

    describe("when two rows point at the same trace", () => {
      /** @scenario "Rows that share a trace count once" */
      it("counts the trace once", () => {
        setItems([
          { id: "item-1", traceId: "trace-1", doneAt: null },
          { id: "item-2", traceId: "trace-1", doneAt: null },
          { id: "item-3", traceId: "trace-2", doneAt: null },
        ]);
        renderTable();

        fireEvent.click(headerCheckbox());

        expect(selectionBar()).toHaveTextContent("2 selected");
      });
    });

    describe("when the reviewer moves to another page", () => {
      /** @scenario "Moving to another page clears the selection" */
      it("drops the selection", () => {
        const view = renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        expect(selectionBar()).toBeInTheDocument();

        mocks.pageOffset = 25;
        view.rerender(
          <ChakraProvider value={defaultSystem}>
            <AnnotationsTable heading="Annotations" />
          </ChakraProvider>,
        );

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
    /** @scenario "The selection bar appears with the count and the action" */
    it("shows the count and offers Add to dataset", () => {
      renderTable();

      fireEvent.click(rowCheckbox("trace-1"));
      fireEvent.click(rowCheckbox("trace-2"));

      expect(selectionBar()).toHaveTextContent("2 selected");
      expect(
        screen.getByRole("button", { name: /Add to dataset/ }),
      ).toBeInTheDocument();
    });

    describe("when the user clicks Add to dataset", () => {
      /** @scenario "Add to dataset opens the dataset drawer with the selected traces" */
      it("opens the dataset drawer with the selected trace ids", async () => {
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(rowCheckbox("trace-3"));
        fireEvent.click(screen.getByRole("button", { name: /Add to dataset/ }));

        await vi.waitFor(() =>
          expect(mocks.openDrawer).toHaveBeenCalledWith("addDatasetRecord", {
            selectedTraceIds: ["trace-1", "trace-3"],
          }),
        );
      });

      /** @scenario "Add to dataset waits for the personal workspace to allow datasets" */
      it("does not open the drawer when the datasets gate is declined", async () => {
        mocks.gateAllows = false;
        renderTable();

        fireEvent.click(rowCheckbox("trace-1"));
        fireEvent.click(screen.getByRole("button", { name: /Add to dataset/ }));

        await vi.waitFor(() => expect(mocks.gateAllows).toBe(false));
        expect(mocks.openDrawer).not.toHaveBeenCalled();
      });
    });
  });
});
