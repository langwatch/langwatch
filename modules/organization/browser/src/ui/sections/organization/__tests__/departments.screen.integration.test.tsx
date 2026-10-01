/**
 * @vitest-environment jsdom
 * The organization's departments, referenced read-only on the Directory and managed on
 * Governance's People page.
 * @see specs/ai-gateway/governance/departments.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import DepartmentsScreen from "../departments.screen.tsx";

const state = vi.hoisted(() => ({
  departments: [] as { id: string; name: string }[],
  byUser: new Map<string, string | null>(),
  byTeam: new Map<string, string | null>(),
  byProject: new Map<string, string | null>(),
  members: [] as { userId: string }[],
}));

vi.mock("../../../../behavior/use-department-column.ts", () => ({
  useDepartmentColumn: () => ({
    show: state.departments.length > 0,
    departments: state.departments,
    byUser: state.byUser,
    byTeam: state.byTeam,
    byProject: state.byProject,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/organization-api.ts", () => ({
  api: {
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: state.members }, isError: false }),
      },
    },
  },
}));

const renderDepartments = () =>
  renderWithOrganizationHost(
    <DepartmentsScreen organizationId="org-1" />,
    new FakeOrganizationHost(),
  );

beforeEach(() => {
  state.departments = [
    { id: "dep_eng", name: "Engineering" },
    { id: "dep_sales", name: "Sales" },
  ];
  state.byUser = new Map<string, string | null>([
    ["user_sam", "dep_eng"],
    ["user_ana", "dep_eng"],
    ["user_rex", null],
  ]);
  state.byTeam = new Map<string, string | null>([["team_platform", "dep_eng"]]);
  state.byProject = new Map<string, string | null>();
  state.members = [{ userId: "user_sam" }, { userId: "user_ana" }, { userId: "user_rex" }];
});

afterEach(cleanup);

describe("given an organization with departments", () => {
  /** @scenario A department says how much it holds, in its own words */
  it("names each department with the people, teams and projects it holds", () => {
    renderDepartments();

    const rows = screen.getAllByTestId("department-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Engineering");
    expect(rows[0]).toHaveTextContent("2 people · 1 team");
    expect(rows[0]).not.toHaveTextContent("project");
    expect(rows[1]).toHaveTextContent("Sales");
    expect(rows[1]).toHaveTextContent("Nobody assigned yet");
  });

  /** @scenario The people no department holds are counted underneath */
  it("counts the unassigned underneath, rather than inventing a department for them", () => {
    renderDepartments();

    expect(screen.getByText("1 person unassigned")).toBeInTheDocument();
  });

  /** @scenario Assignment stays where it is managed */
  it("sends assignment to Governance rather than offering a second place for it", () => {
    renderDepartments();

    expect(screen.getByRole("link", { name: /manage in governance/i })).toHaveAttribute(
      "href",
      "/governance/people",
    );
    expect(within(screen.getByTestId("departments-list")).queryByRole("button")).toBeNull();
  });
});
