/**
 * @vitest-environment jsdom
 *
 * Integration test for the datasets list page while its data is in flight.
 *
 * The list is the surface a customer lands on first, and the query behind it
 * can take a moment on a large project. It has to read as "loading", never as
 * "you have no datasets" — an empty-state flash sends people off to create a
 * dataset they already have.
 *
 * Spec: specs/datasets/datasets-list-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { datasetsQueryRef } = vi.hoisted(() => ({
  datasetsQueryRef: {
    current: { data: undefined as unknown, isLoading: true },
  },
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), back: vi.fn() }),
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
    drawerOpen: () => false,
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useDeleteDatasetConfirmation", () => ({
  useDeleteDatasetConfirmation: () => ({
    openDeleteDialog: vi.fn(),
    DeleteDialog: () => null,
  }),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: (props: P) => ReactNode) =>
    (props: P) =>
      Component(props),
}));

vi.mock("../../components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

vi.mock("~/features/langy/components/LangyContextTarget", () => ({
  LangyContextTarget: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: () => null,
}));

vi.mock("../../components/datasets/bulkUpload/BulkUploadDrawer", () => ({
  BulkUploadDrawer: () => null,
}));

vi.mock("../../components/datasets/CopyDatasetDialog", () => ({
  CopyDatasetDialog: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ dataset: { getAll: { invalidate: vi.fn() } } }),
    dataset: {
      getAll: { useQuery: () => datasetsQueryRef.current },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

const DatasetsPage = (await import("../[project]/datasets")).default;

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <DatasetsPage />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("datasets list page", () => {
  describe("given my datasets are still being fetched", () => {
    describe("when the page renders", () => {
      /** @scenario "The list loads while I wait, and tells me it is loading" */
      it("shows loading placeholders instead of the empty-project message", () => {
        datasetsQueryRef.current = { data: undefined, isLoading: true };

        const { container } = renderPage();

        expect(
          container.querySelectorAll("[class*='chakra-skeleton']").length,
        ).toBeGreaterThan(0);
        expect(screen.queryByText("No datasets yet")).not.toBeInTheDocument();
        // The table's own scaffolding is up, so the page does not jump when the
        // rows land.
        expect(screen.getByText("Entries")).toBeInTheDocument();
      });
    });
  });

  describe("given the project genuinely has no datasets", () => {
    describe("when the page renders", () => {
      it("shows the empty-project message", () => {
        datasetsQueryRef.current = { data: [], isLoading: false };

        renderPage();

        expect(screen.getByText("No datasets yet")).toBeInTheDocument();
      });
    });
  });
});
