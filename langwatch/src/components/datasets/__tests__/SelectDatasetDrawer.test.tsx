/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SelectDatasetDrawer } from "../SelectDatasetDrawer";
import { api } from "~/utils/api";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock datasets data
const mockDatasets = [
  {
    id: "dataset-1",
    name: "thread_test2",
    columnTypes: [
      { name: "input", type: "string" },
      { name: "output", type: "string" },
    ],
    updatedAt: new Date("2025-01-15T10:00:00Z"),
    createdAt: new Date("2025-01-10T10:00:00Z"),
    projectId: "test-project-id",
  },
  {
    id: "dataset-2",
    name: "Draft Evaluation (245)",
    columnTypes: [
      { name: "question", type: "string" },
      { name: "answer", type: "string" },
      { name: "context", type: "string" },
    ],
    updatedAt: new Date("2025-01-10T10:00:00Z"),
    createdAt: new Date("2025-01-05T10:00:00Z"),
    projectId: "test-project-id",
  },
];

// Mock the API
vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: vi.fn(() => ({
          data: mockDatasets,
          isLoading: false,
        })),
      },
    },
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("SelectDatasetDrawer", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <SelectDatasetDrawer
        open={true}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        {...props}
      />,
      { wrapper: Wrapper }
    );
  };

  describe("Basic rendering", () => {
    it("shows Choose Dataset header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Choose Dataset")).toBeInTheDocument();
      });
    });

    it("shows search input", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search datasets...")).toBeInTheDocument();
      });
    });

    it("shows dataset list", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("thread_test2")).toBeInTheDocument();
        expect(screen.getByText("Draft Evaluation (245)")).toBeInTheDocument();
      });
    });

    it("shows column count for datasets", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("2 columns")).toBeInTheDocument();
        expect(screen.getByText("3 columns")).toBeInTheDocument();
      });
    });
  });

  describe("Search functionality", () => {
    it("filters datasets by name", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("thread_test2")).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText("Search datasets...");
      await user.type(searchInput, "thread");

      await waitFor(() => {
        expect(screen.getByText("thread_test2")).toBeInTheDocument();
        expect(screen.queryByText("Draft Evaluation (245)")).not.toBeInTheDocument();
      });
    });

    it("shows no results message when no matches", async () => {
      const user = userEvent.setup();
      renderDrawer();

      const searchInput = screen.getByPlaceholderText("Search datasets...");
      await user.type(searchInput, "nonexistent");

      await waitFor(() => {
        expect(screen.getByText("No datasets match your search")).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("calls onSelect when clicking a dataset", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("thread_test2")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("dataset-card-thread_test2"));

      expect(mockOnSelect).toHaveBeenCalledWith({
        datasetId: "dataset-1",
        name: "thread_test2",
        columnTypes: expect.any(Array),
      });
    });

    it("closes drawer after selection", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("thread_test2")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("dataset-card-thread_test2"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows spinner when loading", async () => {
      vi.mocked(api.dataset.getAll.useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof api.dataset.getAll.useQuery>);

      renderDrawer();

      // Chakra spinner is a span element with chakra-spinner class
      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty message when no datasets", async () => {
      vi.mocked(api.dataset.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.dataset.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("No datasets found in this project")).toBeInTheDocument();
      });
    });
  });
});
