/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Datasets list page: listing with key facts,
 * search, navigation, and the empty state.
 * See specs/datasets/datasets-list-page.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDatasetsList, mockPush } = vi.hoisted(() => {
  return {
    mockDatasetsList: {
      current: [] as Array<{
        id: string;
        slug: string;
        name: string;
        schema: null;
        columnTypes: Array<{ name: string; type: string }>;
        createdAt: Date;
        updatedAt: Date;
        archivedAt: null;
        projectId: string;
        useS3?: boolean;
        s3RecordCount?: number;
        _count: { datasetRecords: number };
      }>,
    },
    mockPush: vi.fn(),
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: mockPush,
    back: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    organizations: [{ id: "org-1", name: "Test Org" }],
    project: { id: "proj-1", slug: "test-project" },
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: false }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    currentDrawer: undefined,
    setFlowCallbacks: vi.fn(),
    getFlowCallbacks: vi.fn(),
  }),
}));

vi.mock("~/hooks/useDeleteDatasetConfirmation", () => ({
  useDeleteDatasetConfirmation: () => ({
    showDeleteDialog: vi.fn(),
    DeleteDialog: () => <div data-testid="delete-dialog" />,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    dataset: {
      getAll: {
        useQuery: () => ({
          data: mockDatasetsList.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      deleteById: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/components/datasets/UploadCSVDrawer", () => ({
  UploadCSVDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="upload-csv-modal" /> : null,
}));

vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => <div data-testid="add-edit-dataset-drawer" />,
}));

vi.mock("~/components/datasets/CopyDatasetDialog", () => ({
  CopyDatasetDialog: () => <div data-testid="copy-dataset-dialog" />,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

// Lazy import to ensure mocks are set up first
const { default: DatasetsPage } = await import("~/pages/[project]/datasets");

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DatasetsPage />
    </ChakraProvider>,
  );
}

const makeDataset = (
  id: string,
  name: string,
  records: number,
): (typeof mockDatasetsList.current)[number] => ({
  id,
  slug: id,
  name,
  schema: null,
  columnTypes: [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ],
  createdAt: new Date("2026-01-01T10:00:00Z"),
  updatedAt: new Date("2026-02-02T10:00:00Z"),
  archivedAt: null,
  projectId: "proj-1",
  _count: { datasetRecords: records },
});

describe("Datasets list page", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatasetsList.current = [
      makeDataset("ds-1", "offline evals", 12),
      makeDataset("ds-2", "production samples", 3),
    ];
  });

  describe("when the project has datasets", () => {
    /** @scenario Datasets are listed with their key facts */
    it("lists each dataset with name, columns, entry count, and last update", () => {
      renderPage();

      expect(screen.getByText("offline evals")).toBeInTheDocument();
      expect(screen.getByText("production samples")).toBeInTheDocument();
      // Column badges
      expect(screen.getAllByText("input")).toHaveLength(2);
      expect(screen.getAllByText("expected_output")).toHaveLength(2);
      // Entry counts
      expect(screen.getByText("12")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      // Last update uses updatedAt, not createdAt
      const expected = new Date("2026-02-02T10:00:00Z").toLocaleString();
      expect(screen.getAllByText(expected)).toHaveLength(2);
    });

    /** @scenario Search datasets by name */
    it("filters the list as the user searches", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByTestId("datasets-search"), "offline");

      await waitFor(() => {
        expect(
          screen.queryByText("production samples"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText("offline evals")).toBeInTheDocument();
    });

    it("shows a no-results hint when the search matches nothing", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.type(screen.getByTestId("datasets-search"), "zzz");

      expect(
        await screen.findByText(/No datasets match "zzz"/i),
      ).toBeInTheDocument();
    });

    /** @scenario Open a dataset */
    it("navigates to the dataset editor when a row is clicked", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByText("offline evals"));

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: "/test-project/datasets/ds-1",
        }),
      );
    });
  });

  describe("when the project has no datasets", () => {
    beforeEach(() => {
      mockDatasetsList.current = [];
    });

    /** @scenario Empty project shows a helpful empty state */
    it("shows the empty state with a create CTA", async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.getByText("No datasets yet")).toBeInTheDocument();
      const cta = screen.getByTestId("empty-state-create-dataset");
      await user.click(cta);
      expect(await screen.findByTestId("upload-csv-modal")).toBeInTheDocument();
    });
  });
});
