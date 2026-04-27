/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Datasets page permission-based UI visibility.
 *
 * Verifies that edit/delete menu items are gated behind
 * the `datasets:manage` permission for lite members.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsLiteMemberRef, mockDatasetsList, mockDeleteMutate } =
  vi.hoisted(() => {
    return {
      mockIsLiteMemberRef: {
        current: false,
      },
      mockDatasetsList: {
        current: [] as Array<{
          id: string;
          slug: string;
          name: string;
          schema: null;
          columnTypes: Array<{ name: string }>;
          createdAt: Date;
          updatedAt: Date;
          archivedAt: null;
          projectId: string;
          useS3?: boolean;
          s3RecordCount?: number;
          _count: { datasetRecords: number };
        }>,
      },
      mockDeleteMutate: vi.fn(),
    };
  });

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    organizations: [{ id: "org-1", name: "Test Org" }],
    project: { id: "proj-1", slug: "test-project" },
    hasOrgPermission: () => false,
    hasAnyPermission: () => false,
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({
    isLiteMember: mockIsLiteMemberRef.current,
  }),
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
        useMutation: () => ({
          mutate: mockDeleteMutate,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: vi.fn(() => false),
}));

vi.mock("~/components/datasets/UploadCSVModal", () => ({
  UploadCSVModal: () => <div data-testid="upload-csv-modal" />,
}));

vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => (
    <div data-testid="add-edit-dataset-drawer" />
  ),
}));

vi.mock("~/components/datasets/CopyDatasetDialog", () => ({
  CopyDatasetDialog: () => <div data-testid="copy-dataset-dialog" />,
}));

vi.mock("~/components/NoDataInfoBlock", () => ({
  NoDataInfoBlock: () => <div data-testid="no-data-info-block" />,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Heading: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    HeaderButton: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Container: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
  },
}));

vi.mock("~/components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Item: ({
      children,
      ...props
    }: {
      children?: ReactNode;
      [key: string]: any;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href?: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Lazy import to ensure mocks are set up first
const { default: DatasetsPage } = await import(
  "~/pages/[project]/datasets"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DatasetsPage />
    </ChakraProvider>,
  );
}

describe("Datasets page permission visibility", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLiteMemberRef.current = false;
    mockDatasetsList.current = [
      {
        id: "ds-1",
        slug: "test-dataset",
        name: "Test Dataset",
        schema: null,
        columnTypes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: "proj-1",
        _count: { datasetRecords: 5 },
      },
    ];
  });

  describe("when user is not a lite member", () => {
    beforeEach(() => {
      mockIsLiteMemberRef.current = false;
    });

    it("shows edit and delete menu items", () => {
      renderPage();

      expect(screen.getByText("Edit dataset")).toBeTruthy();
      expect(screen.getByText("Delete dataset")).toBeTruthy();
    });
  });

  describe("when user is a lite member", () => {
    beforeEach(() => {
      mockIsLiteMemberRef.current = true;
    });

    it("hides edit and delete menu items", () => {
      renderPage();

      expect(screen.queryByText("Edit dataset")).toBeNull();
      expect(screen.queryByText("Delete dataset")).toBeNull();
    });
  });
});
