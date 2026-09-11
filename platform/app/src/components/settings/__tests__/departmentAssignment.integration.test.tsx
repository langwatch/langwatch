/**
 * @vitest-environment jsdom
 *
 * Binds the department assignment UI scenarios from
 * specs/ai-gateway/governance/departments.feature: the departments page
 * manages departments and links out, the picker assigns from the members /
 * teams surfaces, and the control only appears once departments exist.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Imported at the top: vitest hoists the vi.mock / vi.hoisted calls below above
// these statements, so the modules under test still resolve the mocks.
import PeoplePage from "~/pages/governance/people";
import { DepartmentPicker } from "../DepartmentPicker";
import { useDepartmentColumn } from "../useDepartmentColumn";

const { ffEnabled, departmentList, assignments, mutations } = vi.hoisted(
  () => ({
    ffEnabled: { current: true },
    departmentList: {
      current: [{ id: "dept_mkt", name: "Marketing" }] as Array<{
        id: string;
        name: string;
      }>,
    },
    assignments: {
      current: {
        users: [] as Array<{
          id: string;
          name: string;
          departmentId: string | null;
        }>,
        teams: [] as Array<{
          id: string;
          name: string;
          departmentId: string | null;
        }>,
        projects: [] as Array<{
          id: string;
          name: string;
          departmentId: string | null;
        }>,
      },
    },
    mutations: {
      assignUser: vi.fn(async () => ({})),
      assignTeam: vi.fn(async () => ({})),
      assignProject: vi.fn(async () => ({})),
    },
  }),
);

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: ffEnabled.current, isLoading: false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    isLoading: false,
    // The page hides its write controls without `governance:manage`, and this
    // test is about what an admin sees.
    hasAnyPermission: () => true,
    hasPermission: () => true,
    hasOrgPermission: () => true,
  }),
}));

// The people page renders inside GovernanceLayout, which pulls in the whole
// dashboard shell — plan lookups, usage banner, nav. None of that is what these
// tests are about, so stand it down to its children. Same stub the governance
// page tests use — see peopleDepartments.integration.test.tsx.
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("~/utils/api", () => {
  // Any router these tests do not steer answers empty rather than throwing.
  // Without this the file needed a fresh stub every time the page gained a
  // panel, and it broke three times in a row that way: usage, permissions,
  // spend-by-user. Same recursive shape the governance page tests use — see
  // peopleDepartments.integration.test.tsx.
  const anyRouter = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({
              data: undefined,
              isLoading: false,
              isFetching: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({
              mutate: vi.fn(),
              mutateAsync: vi.fn(),
              isPending: false,
            });
          }
          if (property === "invalidate") return vi.fn();
          return anyRouter();
        },
      },
    );

  const steered: Record<string, unknown> = {
    useUtils: () => ({
      departments: {
        list: { invalidate: vi.fn() },
        assignments: { invalidate: vi.fn() },
      },
      governancePeople: {
        list: { invalidate: vi.fn() },
        suggestions: { invalidate: vi.fn() },
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
        useMutation: () => ({
          mutateAsync: mutations.assignUser,
          isPending: false,
        }),
      },
      assignTeam: {
        useMutation: () => ({
          mutateAsync: mutations.assignTeam,
          isPending: false,
        }),
      },
      assignProject: {
        useMutation: () => ({
          mutateAsync: mutations.assignProject,
          isPending: false,
        }),
      },
    },
    // The page now carries the discovered-people panel; an empty answer keeps
    // these tests about what they were about — departments and their links.
    governancePeople: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      suggestions: { useQuery: () => ({ data: [], isLoading: false }) },
      runMatch: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      confirmSuggestion: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  };

  return {
    api: new Proxy(steered, {
      get: (target, property) =>
        typeof property === "string" && property in target
          ? target[property]
          : anyRouter(),
    }),
  };
});

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

// The people page reads its tab and filter state from the query string via
// useSearchParams, so rendering it needs a router in context. Same wrapper the
// governance page tests use — see peopleDepartments.integration.test.tsx.
function renderWithChakra(node: ReactNode, entry = "/") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
    </ChakraProvider>,
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
    it("manages departments and links to the members and teams pages instead of listing every person", async () => {
      // Departments are the page's second tab, and the selected tab is part of
      // the address — see the usePeopleTab block in pages/governance/people.tsx.
      renderWithChakra(<PeoplePage />, "/governance/people?tab=departments");

      expect(screen.getByText("Add department")).toBeDefined();

      // The three assignment links now sit behind a disclosure rather than
      // filling the tab. They still have to be reachable and still have to
      // point at the settings pages that do the assigning.
      await userEvent.click(
        screen.getByRole("button", { name: /How departments are assigned/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /^People/i })).toBeDefined();
      });

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
