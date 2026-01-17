/**
 * @vitest-environment jsdom
 *
 * Integration tests for DatasetTabs user interactions.
 * Tests actual user behavior with react-testing-library.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetTabs } from "../components/DatasetSection/DatasetTabs";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { type DatasetReference, DEFAULT_TEST_DATA_ID } from "../types";

// Mock callbacks
const mockOnSelectExisting = vi.fn();
const mockOnUploadCSV = vi.fn();
const mockOnEditDataset = vi.fn();
const mockOnSaveAsDataset = vi.fn();

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDatasetTabs = () => {
  return render(
    <DatasetTabs
      onSelectExisting={mockOnSelectExisting}
      onUploadCSV={mockOnUploadCSV}
      onEditDataset={mockOnEditDataset}
      onSaveAsDataset={mockOnSaveAsDataset}
    />,
    { wrapper: Wrapper },
  );
};

// Helper to create test datasets
const createInlineDataset = (
  id: string,
  name: string,
  columns = [
    { id: "input", name: "input", type: "string" as const },
    { id: "expected_output", name: "expected_output", type: "string" as const },
  ],
): DatasetReference => ({
  id,
  name,
  type: "inline",
  columns,
  inline: {
    columns,
    records: Object.fromEntries(columns.map((c) => [c.id, ["", "", ""]])),
  },
});

const createSavedDataset = (id: string, name: string): DatasetReference => ({
  id,
  name,
  type: "saved",
  datasetId: `db-${id}`,
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "output", name: "output", type: "string" },
  ],
});

describe("DatasetTabs user interactions", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Feature: View dataset tabs", () => {
    it("displays Datasets label with database icon", () => {
      renderDatasetTabs();

      expect(screen.getByText("Datasets")).toBeInTheDocument();
    });

    it("displays the default Test Data tab", () => {
      renderDatasetTabs();

      expect(screen.getByText("Test Data")).toBeInTheDocument();
    });

    it("displays add (+) button for adding datasets", () => {
      renderDatasetTabs();

      expect(screen.getByLabelText("Add dataset")).toBeInTheDocument();
    });

    it("displays edit button for editing current dataset", () => {
      renderDatasetTabs();

      expect(screen.getByLabelText("Edit dataset columns")).toBeInTheDocument();
    });
  });

  describe("Feature: Switch datasets by clicking inactive tab", () => {
    it("switches to clicked dataset when clicking an inactive tab", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      // Add a second dataset
      store.addDataset(createInlineDataset("production", "Production Samples"));

      renderDatasetTabs();

      // Verify Test Data is active
      expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
        DEFAULT_TEST_DATA_ID,
      );

      // Click the Production Samples tab (which should be inactive)
      await user.click(screen.getByText("Production Samples"));

      // Verify it switched
      expect(useEvaluationsV3Store.getState().activeDatasetId).toBe(
        "production",
      );
    });

    it("does not show dropdown menu when clicking inactive tab", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      store.addDataset(createInlineDataset("other", "Other Dataset"));

      renderDatasetTabs();

      // Click the inactive tab
      await user.click(screen.getByText("Other Dataset"));

      // Should NOT show dropdown menu items
      expect(screen.queryByText("Save as dataset")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Remove from workbench"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Feature: Active tab dropdown menu", () => {
    it("opens dropdown menu when clicking active tab", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      // Click the active Test Data tab
      await user.click(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      );

      // Should show dropdown menu
      await waitFor(() => {
        expect(screen.getByText("Save as dataset")).toBeInTheDocument();
      });
    });

    it("shows Save as dataset option for inline datasets", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      );

      await waitFor(() => {
        expect(screen.getByText("Save as dataset")).toBeInTheDocument();
      });
    });

    it("does NOT show Save as dataset for saved datasets", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      // Add and activate a saved dataset
      store.addDataset(createSavedDataset("saved-ds", "Saved Dataset"));
      store.setActiveDataset("saved-ds");

      renderDatasetTabs();

      // Click the active saved tab
      await user.click(screen.getByTestId("dataset-tab-saved-ds"));

      // Wait for menu to render, then check Save as dataset is NOT there
      await waitFor(() => {
        // The menu should open (we'd see Remove option if multiple datasets)
        // But Save as dataset should NOT be present for saved datasets
        expect(screen.queryByText("Save as dataset")).not.toBeInTheDocument();
      });
    });

    it("shows Remove from workbench when multiple datasets exist", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      store.addDataset(createInlineDataset("other", "Other Dataset"));

      renderDatasetTabs();

      await user.click(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      );

      await waitFor(() => {
        expect(screen.getByText("Remove from workbench")).toBeInTheDocument();
      });
    });

    it("does NOT show Remove from workbench when only one dataset", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      );

      await waitFor(() => {
        // Menu should open
        expect(screen.getByText("Save as dataset")).toBeInTheDocument();
        // But remove from workbench option should be disabled
        expect(
          screen
            .queryByText("Remove from workbench")
            ?.closest('[role="menuitem"]'),
        ).toHaveAttribute("aria-disabled", "true");
      });
    });
  });

  describe("Feature: Save as dataset", () => {
    it("calls onSaveAsDataset with dataset when clicking Save as dataset", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      // Open dropdown
      await user.click(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      );

      // Click Save as dataset
      await waitFor(() => {
        expect(screen.getByText("Save as dataset")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Save as dataset"));

      // Verify callback was called with the dataset
      expect(mockOnSaveAsDataset).toHaveBeenCalledTimes(1);
      expect(mockOnSaveAsDataset).toHaveBeenCalledWith(
        expect.objectContaining({
          id: DEFAULT_TEST_DATA_ID,
          name: "Test Data",
          type: "inline",
        }),
      );
    });
  });

  describe("Feature: Remove dataset from workbench", () => {
    it("removes dataset when clicking Remove from workbench", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      store.addDataset(createInlineDataset("to-remove", "Dataset to Remove"));
      store.setActiveDataset("to-remove");

      renderDatasetTabs();

      // Open dropdown on active tab
      await user.click(screen.getByTestId("dataset-tab-to-remove"));

      await waitFor(() => {
        expect(screen.getByText("Remove from workbench")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Remove from workbench"));

      // Verify dataset was removed
      const state = useEvaluationsV3Store.getState();
      expect(state.datasets.find((d) => d.id === "to-remove")).toBeUndefined();
      // Should switch to first remaining dataset
      expect(state.activeDatasetId).toBe(DEFAULT_TEST_DATA_ID);
    });
  });

  describe("Feature: Add dataset menu", () => {
    it("shows options in correct order: Select existing, Upload CSV, Create new", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      // Open add menu
      await user.click(screen.getByLabelText("Add dataset"));

      await waitFor(() => {
        expect(screen.getByText("Select existing dataset")).toBeInTheDocument();
        expect(screen.getByText("Upload CSV")).toBeInTheDocument();
        expect(screen.getByText("Create new")).toBeInTheDocument();
      });

      // Verify order by checking menu items
      const menuItems = screen.getAllByRole("menuitem");
      expect(menuItems[0]).toHaveTextContent("Select existing dataset");
      expect(menuItems[1]).toHaveTextContent("Upload CSV");
      expect(menuItems[2]).toHaveTextContent("Create new");
    });

    it("calls onSelectExisting when clicking Select existing dataset", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Select existing dataset")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select existing dataset"));

      expect(mockOnSelectExisting).toHaveBeenCalledTimes(1);
    });

    it("calls onUploadCSV when clicking Upload CSV", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Upload CSV")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Upload CSV"));

      expect(mockOnUploadCSV).toHaveBeenCalledTimes(1);
    });

    it("creates new dataset with copied columns when clicking Create new", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      // Add a custom column to the first dataset
      store.addColumn(DEFAULT_TEST_DATA_ID, {
        id: "context",
        name: "context",
        type: "string",
      });

      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Create new")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Create new"));

      // Verify new dataset was created with copied columns
      const state = useEvaluationsV3Store.getState();
      expect(state.datasets.length).toBe(2);

      const newDataset = state.datasets[1];
      expect(newDataset?.name).toBe("Dataset 2");
      expect(newDataset?.columns.map((c) => c.name)).toContain("input");
      expect(newDataset?.columns.map((c) => c.name)).toContain(
        "expected_output",
      );
      expect(newDataset?.columns.map((c) => c.name)).toContain("context");

      // Should become active
      expect(state.activeDatasetId).toBe(newDataset?.id);
    });
  });

  describe("Feature: Edit dataset button", () => {
    it("calls onEditDataset when clicking edit button", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Edit dataset columns"));

      expect(mockOnEditDataset).toHaveBeenCalledTimes(1);
    });
  });

  describe("Feature: Dataset type indicators", () => {
    it("shows multiple dataset tabs when multiple datasets exist", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createInlineDataset("ds2", "Dataset 2"));
      store.addDataset(createSavedDataset("ds3", "Dataset 3"));

      renderDatasetTabs();

      expect(screen.getByText("Test Data")).toBeInTheDocument();
      expect(screen.getByText("Dataset 2")).toBeInTheDocument();
      expect(screen.getByText("Dataset 3")).toBeInTheDocument();
    });
  });
});
