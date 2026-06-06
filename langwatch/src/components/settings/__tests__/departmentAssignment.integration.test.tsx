/**
 * @vitest-environment jsdom
 *
 * Binds the department assignment UI scenarios from
 * specs/ai-gateway/governance/departments.feature: the departments page
 * manages departments and links out, the picker assigns from the members /
 * teams surfaces, and the control only appears once departments exist.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Imported at the top: vitest hoists the vi.mock / vi.hoisted calls below above
// these statements, so the modules under test still resolve the mocks.
import DepartmentsPage from "~/pages/settings/governance/departments";
import { DepartmentPicker } from "../DepartmentPicker";
import { useDepartmentColumn } from "../useDepartmentColumn";

const { ffEnabled, departmentList, assignments, mutations } = vi.hoisted(() => ({
  ffEnabled: { current: true },
  departmentList: {
    current: [{ id: "dept_mkt", name: "Marketing" }] as Array<{
      id: string;
      name: string;
    }>,
  },
  assignments: {
    current: {
      users: [] as Array<{ id: string; name: string; departmentId: string | null }>,
      teams: [] as Array<{ id: string; name: string; departmentId: string | null }>,
      projects: [] as Array<{ id: string; name: string; departmentId: string | null }>,
    },
  },
  mutations: {
    assignUser: vi.fn(async () => ({})),
    assignTeam: vi.fn(async () => ({})),
    assignProject: vi.fn(async () => ({})),
  },
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: ffEnabled.current, isLoading: false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    isLoading: false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      departments: {
        list: { invalidate: vi.fn() },
        assignments: { invalidate: vi.fn() },
      },
    }),
    departments: {
      list: {
        useQuery: () => ({ data: departmentList.current, isLoading: false }),
      },
      assignments: {
        useQuery: () => ({ data: assignments.current, isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      rename: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      assignUser: {
        useMutation: () => ({ mutateAsync: mutations.assignUser, isPending: false }),
      },
      assignTeam: {
        useMutation: () => ({ mutateAsync: mutations.assignTeam, isPending: false }),
      },
      assignProject: {
        useMutation: () => ({
          mutateAsync: mutations.assignProject,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/WithFeatureFlagGuard", () => ({
  withFeatureFlagGuard: () => (C: any) => C,
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (C: any) => C,
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

function renderWithChakra(node: ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>,
  );
}

describe("department assignment UI", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    ffEnabled.current = true;
    departmentList.current = [{ id: "dept_mkt", name: "Marketing" }];
    assignments.current = { users: [], teams: [], projects: [] };
  });

  describe("given the departments page", () => {
    /** @scenario The departments page manages departments and links out to assign them */
    it("manages departments and links to the members and teams pages instead of listing every person", () => {
      renderWithChakra(<DepartmentsPage />);

      expect(screen.getByText("Create a department")).toBeDefined();
      expect(
        screen.getByRole("link", { name: /People/i }).getAttribute("href"),
      ).toBe("/settings/members");
      // Anchored to the link title: the Projects link now also mentions the
      // "teams page" in its description and points to /settings/teams too.
      expect(
        screen.getByRole("link", { name: /^Teams/i }).getAttribute("href"),
      ).toBe("/settings/teams");
      expect(
        screen.getByRole("link", { name: /^Projects/i }).getAttribute("href"),
      ).toBe("/settings/teams");
      // The per-person assignment list is gone: no <select> on the page.
      expect(document.querySelector("select")).toBeNull();
    });
  });

  describe("given a member row on the members page", () => {
    /** @scenario A member is assigned to a department from the members page */
    it("assigns the chosen department to that user", () => {
      renderWithChakra(
        <DepartmentPicker
          organizationId="org-1"
          kind="user"
          entityId="user_robin"
          value={null}
          departments={[
            {
              id: "dept_mkt",
              name: "Marketing",
              organizationId: "org-1",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ]}
          onAssigned={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "dept_mkt" },
      });

      expect(mutations.assignUser).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user_robin",
        departmentId: "dept_mkt",
      });
    });
  });

  describe("given a team row on the teams page", () => {
    /** @scenario A team is assigned to a department from the teams page */
    it("assigns the chosen department to that team", () => {
      renderWithChakra(
        <DepartmentPicker
          organizationId="org-1"
          kind="team"
          entityId="team_platform"
          value={null}
          departments={[
            {
              id: "dept_eng",
              name: "Engineering",
              organizationId: "org-1",
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ]}
          onAssigned={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "dept_eng" },
      });

      expect(mutations.assignTeam).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team_platform",
        departmentId: "dept_eng",
      });
    });
  });

  describe("given the governance flag is on", () => {
    /** @scenario The department control appears only once departments are configured */
    it("hides the control until the first department exists, then shows it", () => {
      function Harness() {
        const dept = useDepartmentColumn("org-1");
        return <div data-testid="show">{String(dept.show)}</div>;
      }

      departmentList.current = [];
      const { rerender } = renderWithChakra(<Harness />);
      expect(screen.getByTestId("show").textContent).toBe("false");

      departmentList.current = [{ id: "dept_mkt", name: "Marketing" }];
      rerender(
        <ChakraProvider value={defaultSystem}>
          <Harness />
        </ChakraProvider>,
      );
      expect(screen.getByTestId("show").textContent).toBe("true");
    });
  });
});
