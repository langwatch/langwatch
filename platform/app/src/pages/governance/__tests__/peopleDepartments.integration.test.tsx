/**
 * @vitest-environment jsdom
 *
 * What the People screen does with the two departments a person can carry —
 * the one their provider's directory named, and the one their linked member is
 * assigned to — and the invariants the merged table has to keep: two providers
 * naming one address stay two rows, money nobody can be proven to own is shown
 * once, and an erased person is described by their stand-in and nothing else.
 *
 * The real page renders, with only its boundaries mocked - the layout chrome,
 * the feature flag, the plan, the permission hook and the tRPC client. The
 * department and merge decisions are the page's own.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  people: [] as unknown[],
  departments: [] as unknown[],
  spend: [] as unknown[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: true,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/people",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const dataFor = (path: string): unknown => {
    if (path === "governancePeople.list") return harness.people;
    if (path === "governancePeople.suggestions") return [];
    if (path === "departments.list") return harness.departments;
    if (path === "activityMonitor.spendByUser") return harness.spend;
    return undefined;
  };
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({
              data: dataFor(path.join(".")),
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
              variables: undefined,
            });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );
  return { api: node([]) };
});

import PeoplePage from "../people";

const seenAt = new Date("2026-08-01T00:00:00.000Z");

const discovered = (over: Record<string, unknown>) => ({
  id: `person_${String(over.id ?? over.displayText ?? "x")}`,
  provider: "copilot_studio_dataverse",
  kind: "person",
  displayText: "Someone",
  rawActorId: "someone",
  directoryDepartment: null,
  firstSeenAt: seenAt,
  lastSeenAt: seenAt,
  erasedAt: null,
  suspendedAt: null,
  suspendedReason: null,
  link: null,
  ...over,
});

/**
 * The page is two tabs. Everyone the providers named sits on the merged table
 * on the People tab (the default address); the departments their directories
 * named sit on the Departments tab, on the same table as the ones the
 * administrator created.
 */
const renderPage = (entry = "/governance/people") =>
  render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[entry]}>
        <PeoplePage />
      </MemoryRouter>
    </ChakraProvider>,
  );

const DEPARTMENTS_TAB = "/governance/people?tab=departments";

afterEach(() => {
  cleanup();
  harness.people = [];
  harness.departments = [];
  harness.spend = [];
  window.sessionStorage.clear();
});

describe("given people the providers named", () => {
  describe("when the directory filed some of them under a department", () => {
    /** @scenario "An unlinked person shows the department their directory named" */
    it("shows the directory department on a person linked to nobody", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          directoryDepartment: "Engineering",
        }),
      ];
      renderPage();

      const row = screen.getByRole("row", { name: /Maria Silva/ });
      expect(within(row).getByText("Engineering")).toBeInTheDocument();
    });

    /** @scenario "A department only a directory named carries its provider and no row actions" */
    it("lists them on the one table, each with its provider and a headcount", () => {
      harness.people = [
        discovered({
          id: "a",
          displayText: "A",
          directoryDepartment: "Engineering",
        }),
        discovered({
          id: "b",
          displayText: "B",
          directoryDepartment: "Engineering",
        }),
        discovered({ id: "c", displayText: "C", directoryDepartment: "GTM" }),
        discovered({ id: "d", displayText: "D" }),
      ];
      renderPage(DEPARTMENTS_TAB);

      // One table, one heading. The second panel and the paragraph explaining
      // why it existed are gone; the badge carries the whole distinction.
      expect(
        screen.queryByText("Departments the providers see"),
      ).not.toBeInTheDocument();

      const engineering = screen.getByTestId("department-row-Engineering");
      expect(
        within(engineering).getByText("Microsoft Copilot Studio"),
      ).toBeVisible();
      expect(within(engineering).getByText("2 people")).toBeVisible();
      expect(
        within(screen.getByTestId("department-row-GTM")).getByText("1 person"),
      ).toBeVisible();
    });

    /** @scenario "A department only a directory named carries its provider and no row actions" */
    it("offers no rename or archive on a department nobody created", () => {
      // Rename and Archive act on a `Department` record. A name a directory
      // asserted is not one, which is the difference the separate panel used to
      // enforce by being separate.
      harness.people = [
        discovered({ displayText: "A", directoryDepartment: "Engineering" }),
      ];
      renderPage(DEPARTMENTS_TAB);

      expect(screen.getByText("Engineering")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Actions for Engineering" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the organization created the same department the directory names", () => {
    /** @scenario "A department the organization created and one a directory names are one row" */
    it("renders one row carrying the record's actions and the provider badge", () => {
      harness.departments = [{ id: "dept_1", name: "Engineering" }];
      harness.people = [
        discovered({ displayText: "A", directoryDepartment: "Engineering" }),
      ];
      renderPage(DEPARTMENTS_TAB);

      expect(screen.getAllByTestId(/^department-row-/)).toHaveLength(1);
      const row = screen.getByTestId("department-row-Engineering");
      expect(within(row).getByText("Microsoft Copilot Studio")).toBeVisible();
      // It is still the organization's record, so it can still be managed.
      expect(
        screen.getByRole("button", { name: "Actions for Engineering" }),
      ).toBeVisible();
    });
  });

  describe("when no directory named a department for anybody", () => {
    /** @scenario "A department no directory named reports no headcount rather than zero" */
    it("reports no directory headcount rather than zero", () => {
      harness.departments = [{ id: "dept_1", name: "Finance" }];
      harness.people = [discovered({ displayText: "Maria Silva" })];
      renderPage(DEPARTMENTS_TAB);

      const row = screen.getByTestId("department-row-Finance");
      expect(within(row).getByText("—")).toBeVisible();
      expect(within(row).queryByText("0 people")).not.toBeInTheDocument();

      // The dash only reads as "not measured" if the column says what it
      // measured. Without the label a reader who knows Finance has people in
      // it reads the dash as a defect in the page.
      expect(screen.getByText("People named by a source")).toBeVisible();
    });

    it("says the table is empty when nobody created one either", () => {
      harness.people = [discovered({ displayText: "Maria Silva" })];
      renderPage(DEPARTMENTS_TAB);

      expect(
        screen.getByText(
          "No departments yet. Create one to start attributing spend.",
        ),
      ).toBeVisible();
    });
  });

  describe("when a person is linked to a member with a department", () => {
    it("still shows the linked member and their department", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          link: {
            userId: "user-1",
            evidenceKind: "verified_email",
            memberName: "Maria Silva",
            departmentName: "Finance",
          },
        }),
      ];
      renderPage();

      const row = screen.getByRole("row", { name: /Maria Silva/ });
      expect(within(row).getByText("Finance")).toBeInTheDocument();
      expect(within(row).getByText("Matched")).toBeInTheDocument();
    });

    /** @scenario "The directory's department wins over the linked member's" */
    it("prefers the directory's department over the linked member's", () => {
      harness.people = [
        discovered({
          displayText: "Maria Silva",
          directoryDepartment: "Engineering",
          link: {
            userId: "user-1",
            evidenceKind: "verified_email",
            memberName: "Maria Silva",
            departmentName: "Finance",
          },
        }),
      ];
      renderPage();

      const row = screen.getByRole("row", { name: /Maria Silva/ });
      expect(within(row).getByText("Engineering")).toBeInTheDocument();
      expect(within(row).queryByText("Finance")).not.toBeInTheDocument();
    });
  });

  describe("when a person has been erased", () => {
    /** @scenario "An erased person's row names nobody it should not" */
    it("shows the stand-in and nothing else about them", () => {
      harness.people = [
        discovered({
          displayText: "pseudonym_abc",
          rawActorId: "pseudonym_abc",
          // Erasure nulls the stored column; a row that somehow kept one must
          // still not render it beside a person we were asked to forget.
          directoryDepartment: "Engineering",
          erasedAt: seenAt,
        }),
      ];
      renderPage();

      const row = screen.getByRole("row", { name: /pseudonym_abc/ });
      expect(within(row).getByText("Erased")).toBeInTheDocument();
      expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
      expect(within(row).queryByText(/Seen at/)).not.toBeInTheDocument();
    });
  });
});

describe("given two providers that named the same address", () => {
  const AT_TWO_PROVIDERS = [
    {
      ...discovered({
        id: "copilot",
        displayText: "M Silva",
        rawActorId: "m.silva@example.com",
      }),
      provider: "copilot_studio_dataverse",
    },
    {
      ...discovered({
        id: "openai",
        displayText: "M Silva",
        rawActorId: "m.silva@example.com",
      }),
      provider: "openai_admin",
    },
  ];

  describe("when the merged table renders", () => {
    /** @scenario "The same identifier at two providers stays two rows" */
    it("keeps them two rows, one per provider", () => {
      harness.people = AT_TWO_PROVIDERS;
      renderPage();

      const rows = screen.getAllByRole("row", { name: /M Silva/ });
      expect(rows).toHaveLength(2);
      expect(
        rows.filter((row) => within(row).queryByText(/Copilot/)).length,
      ).toBe(1);
      expect(
        rows.filter((row) => within(row).queryByText(/OpenAI/)).length,
      ).toBe(1);
    });

    /** @scenario "Spend claimed by two providers is shown once, on neither of them" */
    it("leaves the money they both claim on a row of its own", () => {
      harness.people = AT_TWO_PROVIDERS;
      harness.spend = [
        {
          actor: "m.silva@example.com",
          spendUsd: "42",
          requests: 100,
          lastActivityIso: seenAt.toISOString(),
          trendVsPreviousPct: 0,
          hasPriorBaseline: false,
          mostUsedTarget: null,
        },
      ];
      renderPage();

      // Exactly one row shows the figure, and it is not either provider's.
      const spendCells = screen.getAllByText("$42.00");
      expect(spendCells).toHaveLength(1);
      const providerRows = screen.getAllByRole("row", { name: /M Silva/ });
      expect(providerRows).toHaveLength(2);
      for (const row of providerRows) {
        expect(within(row).queryByText("$42.00")).not.toBeInTheDocument();
      }
    });
  });
});
