/**
 * @vitest-environment jsdom
 *
 * Roles and their assignments, as two tabs of one page.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, isLoading: false }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (Component: unknown) => Component,
}));

// The assignments panel has its own tests; here it only has to be the tab.
vi.mock("~/components/access/RoleAssignmentsPanel", () => ({
  RoleAssignmentsPanel: () => (
    <div data-testid="assignments-panel">assignments</div>
  ),
}));

const emptyQuery = () => ({
  data: [],
  isLoading: false,
  isError: false,
  error: null,
});

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      role: { getAll: { invalidate: vi.fn() }, getById: { fetch: vi.fn() } },
      roleBinding: { listForOrg: { invalidate: vi.fn() } },
    }),
    role: {
      getAll: { useQuery: emptyQuery },
      create: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    roleBinding: { listForOrg: { useQuery: emptyQuery } },
    apiKey: {
      orgTeams: { useQuery: emptyQuery },
      orgProjects: { useQuery: emptyQuery },
    },
  },
}));

const RolesPage = (await import("../roles")).default;

function renderRoles(initialEntry = "/settings/roles") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ChakraProvider value={defaultSystem}>
        <Routes>
          <Route path="/settings/roles" element={<RolesPage />} />
        </Routes>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("given the roles page", () => {
  afterEach(() => cleanup());

  describe("when it opens", () => {
    /** @scenario The old role bindings address forwards onto the tab it became */
    it("shows the definitions first and the assignments as a second tab", () => {
      renderRoles();

      expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByRole("tab", { name: "Role assignments" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Predefined roles")).toBeInTheDocument();
    });

    /** @scenario The old role bindings address forwards onto the tab it became */
    it("opens straight onto the assignments when the address says so", () => {
      renderRoles("/settings/roles?tab=assignments");

      expect(
        screen.getByRole("tab", { name: "Role assignments" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("assignments-panel")).toBeInTheDocument();
    });

    /** @scenario The screen says role assignment, never binding */
    it("keeps the create-role action to the tab that owns it", async () => {
      renderRoles();

      expect(
        screen.getByRole("button", { name: /New role/ }),
      ).toBeInTheDocument();

      // The tab state settles a tick after the click, so the switch is waited
      // for rather than assumed.
      await userEvent.click(
        screen.getByRole("tab", { name: "Role assignments" }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("tab", { name: "Role assignments" }),
        ).toHaveAttribute("aria-selected", "true"),
      );

      // Assignments are made where their subject lives — on a person, in the
      // person drawer — so this tab offers no create action of its own.
      expect(screen.queryByRole("button", { name: /New role/ })).toBeNull();
    });
  });
});
