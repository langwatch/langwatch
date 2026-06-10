/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
const createTestDataset = (
  id: string,
  name: string,
  type: "inline" | "saved" = "inline",
): DatasetReference => ({
  id,
  name,
  type,
  columns: [
    { id: "input", name: "input", type: "string" },
    { id: "expected_output", name: "expected_output", type: "string" },
  ],
  ...(type === "inline"
    ? {
        inline: {
          columns: [
            { id: "input", name: "input", type: "string" },
            { id: "expected_output", name: "expected_output", type: "string" },
          ],
          records: { input: [""], expected_output: [""] },
        },
      }
    : { datasetId: `db-${id}` }),
});

describe("DatasetTabs", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Dataset header display", () => {
    it("shows Datasets label", () => {
      renderDatasetTabs();
      expect(screen.getByText("Datasets")).toBeInTheDocument();
    });

    it("shows default Test Data tab", () => {
      renderDatasetTabs();
      expect(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      ).toBeInTheDocument();
      expect(screen.getByText("Test Data")).toBeInTheDocument();
    });

    it("shows add button", () => {
      renderDatasetTabs();
      expect(screen.getByLabelText("Add dataset")).toBeInTheDocument();
    });

    it("shows edit button", () => {
      renderDatasetTabs();
      expect(screen.getByLabelText("Edit dataset columns")).toBeInTheDocument();
    });
  });

  describe("Active tab behavior", () => {
    it("active tab exists and is rendered", () => {
      renderDatasetTabs();
      const activeTab = screen.getByTestId(
        `dataset-tab-${DEFAULT_TEST_DATA_ID}`,
      );
      expect(activeTab).toBeInTheDocument();
    });
  });

  describe("Inactive tab behavior", () => {
    it("clicking inactive tab switches to that dataset", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      // Add a second dataset
      store.addDataset(createTestDataset("ds-2", "Other Dataset"));

      renderDatasetTabs();

      // Click the inactive tab
      const inactiveTab = screen.getByTestId("dataset-tab-ds-2");
      await user.click(inactiveTab);

      // Should switch active dataset
      expect(useEvaluationsV3Store.getState().activeDatasetId).toBe("ds-2");
    });
  });

  describe("Dataset type indicators", () => {
    it("shows multiple tabs when multiple datasets exist", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("ds-2", "Other Dataset"));

      renderDatasetTabs();

      expect(
        screen.getByTestId(`dataset-tab-${DEFAULT_TEST_DATA_ID}`),
      ).toBeInTheDocument();
      expect(screen.getByTestId("dataset-tab-ds-2")).toBeInTheDocument();
    });

    it("shows saved dataset tab", () => {
      const store = useEvaluationsV3Store.getState();
      store.addDataset(createTestDataset("saved-ds", "Saved Dataset", "saved"));

      renderDatasetTabs();

      expect(screen.getByTestId("dataset-tab-saved-ds")).toBeInTheDocument();
      expect(screen.getByText("Saved Dataset")).toBeInTheDocument();
    });
  });

  describe("Add dataset menu", () => {
    it("opens menu when clicking + button", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));

      await waitFor(() => {
        expect(screen.getByText("Select existing dataset")).toBeInTheDocument();
        expect(screen.getByText("Upload CSV")).toBeInTheDocument();
        expect(screen.getByText("Create new")).toBeInTheDocument();
      });
    });

    it("calls onSelectExisting when clicking select existing", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Select existing dataset")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Select existing dataset"));

      expect(mockOnSelectExisting).toHaveBeenCalled();
    });

    it("calls onUploadCSV when clicking upload CSV", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Upload CSV")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Upload CSV"));

      expect(mockOnUploadCSV).toHaveBeenCalled();
    });

    it("creates new dataset when clicking create new", async () => {
      const user = userEvent.setup();

      renderDatasetTabs();

      await user.click(screen.getByLabelText("Add dataset"));
      await waitFor(() => {
        expect(screen.getByText("Create new")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Create new"));

      // New dataset should be created
      const state = useEvaluationsV3Store.getState();
      expect(state.datasets.length).toBe(2);
    });

    it("new dataset copies columns from first dataset", async () => {
      const user = userEvent.setup();
      const store = useEvaluationsV3Store.getState();

      // First dataset has custom columns
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

      // New dataset should have same columns as first dataset
      const state = useEvaluationsV3Store.getState();
      const newDataset = state.datasets[1];
      expect(newDataset?.columns.map((c) => c.name)).toContain("context");
    });
  });

  describe("Edit dataset button", () => {
    it("calls onEditDataset when clicking edit button", async () => {
      const user = userEvent.setup();
      renderDatasetTabs();

      await user.click(screen.getByLabelText("Edit dataset columns"));

      expect(mockOnEditDataset).toHaveBeenCalled();
    });
  });
});

describe("DatasetTabs store operations", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
  });

  it("removes dataset from store", () => {
    const store = useEvaluationsV3Store.getState();
    store.addDataset(createTestDataset("ds-2", "Other Dataset"));
    store.setActiveDataset("ds-2");

    // Remove the dataset
    store.removeDataset("ds-2");

    const state = useEvaluationsV3Store.getState();
    expect(state.datasets.find((d) => d.id === "ds-2")).toBeUndefined();
    // Should switch to first dataset
    expect(state.activeDatasetId).toBe(DEFAULT_TEST_DATA_ID);
  });

  it("cannot remove the last dataset", () => {
    const store = useEvaluationsV3Store.getState();

    // Try to remove the only dataset
    store.removeDataset(DEFAULT_TEST_DATA_ID);

    // Should still have the dataset
    const state = useEvaluationsV3Store.getState();
    expect(state.datasets.length).toBe(1);
    expect(state.datasets[0]?.id).toBe(DEFAULT_TEST_DATA_ID);
  });

  it("switches active dataset", () => {
    const store = useEvaluationsV3Store.getState();
    store.addDataset(createTestDataset("ds-2", "Other Dataset"));

    store.setActiveDataset("ds-2");

    expect(useEvaluationsV3Store.getState().activeDatasetId).toBe("ds-2");
  });
});
