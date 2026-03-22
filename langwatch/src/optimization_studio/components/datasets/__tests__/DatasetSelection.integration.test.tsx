/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  });
});
