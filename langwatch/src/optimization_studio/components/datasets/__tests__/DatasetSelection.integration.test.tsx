/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockOpenDrawer = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
  }),
}));

vi.mock("../../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
  }),
}));

vi.mock("../../../../utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      deleteById: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
    useContext: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("../../../../components/datasets/DatasetPreview", () => ({
  DatasetPreview: () => null,
}));

vi.mock("../../../../components/datasets/DatasetTable", () => ({
  DEFAULT_DATASET_NAME: "New Dataset",
}));

vi.mock("../../../hooks/useGetDatasetData", () => ({
  useGetDatasetData: () => ({ rows: [], columns: [] }),
}));

vi.mock("../../../../hooks/useDeleteDatasetConfirmation", () => ({
  useDeleteDatasetConfirmation: () => ({
    showDeleteDialog: vi.fn(),
    DeleteDialog: () => null,
  }),
}));

vi.mock("../../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../../components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children: React.ReactNode }) => children,
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Content: () => null,
    Item: () => null,
  },
}));

import { DatasetSelection } from "../DatasetSelection";

function renderWithProviders(ui: ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("DatasetSelection", () => {
  const defaultProps = {
    node: {
      id: "node-1",
      data: { dataset: undefined },
      type: "entry",
      position: { x: 0, y: 0 },
    } as never,
    setIsEditing: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when clicking the New dataset button", () => {
    it("opens addOrEditDataset drawer directly without forcing file upload", async () => {
      const user = userEvent.setup();

      renderWithProviders(<DatasetSelection {...defaultProps} />);

      const newDatasetButton = screen.getByRole("button", {
        name: /new dataset/i,
      });
      await user.click(newDatasetButton);

      expect(mockOpenDrawer).toHaveBeenCalledTimes(1);
      expect(mockOpenDrawer).toHaveBeenCalledWith("addOrEditDataset", {
        onSuccess: expect.any(Function),
      });

      // Regression: must NOT open uploadCSV drawer
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "uploadCSV",
        expect.anything(),
      );
    });

    it("calls setIsEditing with the created dataset when onSuccess fires", async () => {
      const user = userEvent.setup();

      renderWithProviders(<DatasetSelection {...defaultProps} />);

      const newDatasetButton = screen.getByRole("button", {
        name: /new dataset/i,
      });
      await user.click(newDatasetButton);

      const onSuccess = mockOpenDrawer.mock.calls[0]![1].onSuccess as (
        args: { datasetId: string; name: string },
      ) => void;
      onSuccess({ datasetId: "new-ds-42", name: "My New Dataset" });

      expect(defaultProps.setIsEditing).toHaveBeenCalledWith({
        id: "new-ds-42",
        name: "My New Dataset",
      });
    });
  });

  describe("when a dataset already exists on the node", () => {
    it("opens addOrEditDataset drawer, not uploadCSV", async () => {
      const user = userEvent.setup();
      const propsWithDataset = {
        ...defaultProps,
        node: {
          ...defaultProps.node,
          data: { dataset: { id: "existing-123", name: "Existing Dataset" } },
        } as never,
      };

      renderWithProviders(<DatasetSelection {...propsWithDataset} />);

      const newDatasetButton = screen.getByRole("button", {
        name: /new dataset/i,
      });
      await user.click(newDatasetButton);

      expect(mockOpenDrawer).toHaveBeenCalledWith("addOrEditDataset", {
        onSuccess: expect.any(Function),
      });
      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "uploadCSV",
        expect.anything(),
      );
    });
  });

  // @regression #2506
  describe("when any interaction triggers openDrawer", () => {
    it("never passes uploadCSV to openDrawer", async () => {
      const user = userEvent.setup();

      renderWithProviders(<DatasetSelection {...defaultProps} />);

      const newDatasetButton = screen.getByRole("button", {
        name: /new dataset/i,
      });
      await user.click(newDatasetButton);

      for (const call of mockOpenDrawer.mock.calls) {
        expect(call[0]).not.toBe("uploadCSV"); // @regression #2506
      }
    });
  });
});
