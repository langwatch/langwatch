/**
 * @vitest-environment jsdom
 *
 * The organization's departments, referenced read-only on the Directory and
 * managed on Governance's People page.
 *
 * Spec: specs/ai-gateway/governance/departments.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  departments: [] as { id: string; name: string }[],
  // `string | null`, matching the real hook: `departmentId` is a nullable
  // column and the query answers for every member, team and project, so an
  // unassigned one is null rather than absent. A double narrower than the
  // thing it stands in for cannot catch the mismatch that broke typecheck.
  byUser: new Map<string, string | null>(),
  byTeam: new Map<string, string | null>(),
  byProject: new Map<string, string | null>(),
  members: [] as { userId: string }[],
}));

// The column's flag and degrade-to-empty behaviour is covered where it
// lives; here the section only needs the list and the assignment maps.
vi.mock("~/components/settings/useDepartmentColumn", () => ({
  useDepartmentColumn: () => ({
    show: state.departments.length > 0,
    departments: state.departments,
    byUser: state.byUser,
    byTeam: state.byTeam,
    byProject: state.byProject,
    refetch: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: { members: state.members },
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const { DepartmentsSection } = await import("../DepartmentsSection");

function renderDepartments() {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <DepartmentsSection organizationId="org_acme" />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("given an organization with departments", () => {
  beforeEach(() => {
    state.departments = [
      { id: "dep_eng", name: "Engineering" },
      { id: "dep_sales", name: "Sales" },
    ];
    state.byUser = new Map<string, string | null>([
      ["user_sam", "dep_eng"],
      ["user_ana", "dep_eng"],
      // Unassigned, which is what the nullable column answers for somebody
      // who is in no department. Counted as nobody's, not as everybody's.
      ["user_rex", null],
    ]);
    state.byTeam = new Map<string, string | null>([
      ["team_platform", "dep_eng"],
    ]);
    state.byProject = new Map<string, string | null>();
    state.members = [
      { userId: "user_sam" },
      { userId: "user_ana" },
      { userId: "user_rex" },
    ];
  });
  afterEach(() => cleanup());

  /** @scenario A department says how much it holds, in its own words */
  it("names each department with the people, teams and projects it holds", () => {
    renderDepartments();

    const rows = screen.getAllByTestId("department-row");
    expect(rows).toHaveLength(2);
    // A zero segment is left out rather than read out.
    expect(rows[0]!.textContent).toContain("Engineering");
    expect(rows[0]!.textContent).toContain("2 people · 1 team");
    expect(rows[0]!.textContent).not.toContain("project");
    // And a department holding nothing says so plainly.
    expect(rows[1]!.textContent).toContain("Sales");
    expect(rows[1]!.textContent).toContain("Nobody assigned yet");
  });

  /** @scenario The people no department holds are counted underneath */
  it("counts the unassigned underneath, rather than inventing a department for them", () => {
    renderDepartments();

    expect(screen.getByText("1 person unassigned")).toBeInTheDocument();
  });

  /** @scenario Assignment stays where it is managed */
  it("sends assignment to Governance rather than offering a second place for it", () => {
    renderDepartments();

    expect(
      screen.getByRole("link", { name: /manage in governance/i }),
    ).toHaveAttribute("href", "/governance/people");
    const list = screen.getByTestId("departments-list");
    expect(within(list).queryByRole("button")).toBeNull();
  });
});
