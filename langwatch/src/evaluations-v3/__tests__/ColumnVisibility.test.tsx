/**
 * @vitest-environment jsdom
 *
 * Tests for column visibility feature in the evaluations workbench.
 * Verifies that columns can be hidden/shown via the store and that
 * hidden columns don't render in the table.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { EvaluationsV3Table } from "../components/EvaluationsV3Table";
import type { DatasetColumn } from "../types";

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
  }),
}));

// Mock api
vi.mock("~/utils/api", () => ({
  api: {
    datasetRecord: {
      getAll: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
      update: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
      deleteMany: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
  },
}));

// Mock AddOrEditDatasetDrawer
vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => null,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Column visibility", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Store actions", () => {
    it("toggleColumnVisibility adds column to hiddenColumns", () => {
      const store = useEvaluationsV3Store.getState();

      expect(store.ui.hiddenColumns.has("input")).toBe(false);

      store.toggleColumnVisibility("input");

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.hiddenColumns.has("input")).toBe(true);
    });

    it("toggleColumnVisibility removes column from hiddenColumns when already hidden", () => {
      const store = useEvaluationsV3Store.getState();

      // First hide the column
      store.toggleColumnVisibility("input");
      expect(useEvaluationsV3Store.getState().ui.hiddenColumns.has("input")).toBe(true);

      // Toggle again to show
      store.toggleColumnVisibility("input");
      expect(useEvaluationsV3Store.getState().ui.hiddenColumns.has("input")).toBe(false);
    });

    it("setHiddenColumns replaces all hidden columns", () => {
      const store = useEvaluationsV3Store.getState();

      store.setHiddenColumns(new Set(["input", "expected_output"]));

      const updatedStore = useEvaluationsV3Store.getState();
      expect(updatedStore.ui.hiddenColumns.has("input")).toBe(true);
      expect(updatedStore.ui.hiddenColumns.has("expected_output")).toBe(true);
      expect(updatedStore.ui.hiddenColumns.size).toBe(2);
    });
  });

  describe("Table rendering", () => {
    it("shows all columns when none are hidden", () => {
      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Default columns are 'input' and 'expected_output'
      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();
    });

    it("hides column header when column is in hiddenColumns", () => {
      // Hide the 'input' column before rendering
      useEvaluationsV3Store.getState().toggleColumnVisibility("input");

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // 'input' should not be visible, but 'expected_output' should be
      expect(screen.queryByText("input")).not.toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();
    });

    it("hides cell data for hidden columns", () => {
      // Set up some data
      const store = useEvaluationsV3Store.getState();
      store.setCellValue("test-data", 0, "input", "test input value");
      store.setCellValue("test-data", 0, "expected_output", "test output value");

      // Hide the 'input' column
      store.toggleColumnVisibility("input");

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // The input value cell should not exist (no data-testid="cell-0-input")
      expect(screen.queryByTestId("cell-0-input")).not.toBeInTheDocument();
      // The output value cell should exist
      expect(screen.getByTestId("cell-0-expected_output")).toBeInTheDocument();
    });

    it("shows column again when toggled back to visible", () => {
      const store = useEvaluationsV3Store.getState();

      // Hide and then show
      store.toggleColumnVisibility("input");
      store.toggleColumnVisibility("input");

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();
    });

    it("handles multiple hidden columns", () => {
      const store = useEvaluationsV3Store.getState();

      // Hide both columns
      store.toggleColumnVisibility("input");
      store.toggleColumnVisibility("expected_output");

      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Neither column header should be visible
      expect(screen.queryByText("input")).not.toBeInTheDocument();
      expect(screen.queryByText("expected_output")).not.toBeInTheDocument();
    });
  });

  describe("Dynamic column visibility", () => {
    it("updates table when column visibility changes after render", async () => {
      render(<EvaluationsV3Table />, { wrapper: Wrapper });

      // Initially both columns visible
      expect(screen.getByText("input")).toBeInTheDocument();
      expect(screen.getByText("expected_output")).toBeInTheDocument();

      // Hide 'input' column
      useEvaluationsV3Store.getState().toggleColumnVisibility("input");

      // Wait for re-render - the component should react to store changes
      await vi.waitFor(() => {
        expect(screen.queryByText("input")).not.toBeInTheDocument();
      });
      expect(screen.getByText("expected_output")).toBeInTheDocument();
    });
  });
});
