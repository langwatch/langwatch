/**
 * @vitest-environment jsdom
 *
 * The Directory page: named for what it holds, leading with its status, with
 * people, teams and groups as tabs under it — and departments as a fourth,
 * only where the organization has them and the reader may view governance.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** What `hasPermission` answers, so a reader can hold one half and not the
   *  other — the split the page is built around. */
  permissions: new Set<string>(),
  /** What the department column reports; empty means no departments tab. */
  departments: [] as { id: string; name: string }[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

// The summary band and the four tab bodies all have their own tests; here
// they only have to be present and in the right place.
vi.mock("~/components/access/DirectorySummary", () => ({
  DirectorySummary: () => <div data-testid="directory-summary">status</div>,
}));

vi.mock("~/components/access/DirectoryMembersSection", () => ({
  DirectoryMembersSection: () => (
    <div data-testid="directory-managed-members">people</div>
  ),
}));

vi.mock("~/components/access/GroupsSection", () => ({
  GroupsSection: () => <div data-testid="groups-section">groups</div>,
}));

vi.mock("~/components/access/PeopleSection", () => ({
  PeopleSection: () => <div data-testid="people-section">people</div>,
}));

vi.mock("~/components/access/TeamsAndProjectsSection", () => ({
  TeamsAndProjectsSection: () => <div data-testid="teams-section">teams</div>,
}));

vi.mock("~/components/access/DepartmentsSection", () => ({
  DepartmentsSection: () => (
    <div data-testid="departments-section">departments</div>
  ),
}));

// The department column's flag and query behaviour is covered where it
// lives; here the page only needs to know whether there is anything to show.
vi.mock("~/components/settings/useDepartmentColumn", () => ({
  useDepartmentColumn: () => ({
    show: state.departments.length > 0,
    departments: state.departments,
    byUser: new Map(),
    byTeam: new Map(),
    byProject: new Map(),
    refetch: vi.fn(),
  }),
}));

vi.mock("~/components/access/JoinPolicyCard", () => ({
  JoinPolicyCard: () => <div data-testid="join-policy-card">joining</div>,
}));

vi.mock("~/components/members/useJoinRequests", () => ({
  useJoinRequests: () => ({
    joining: { domainJoin: "off", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
    requests: [],
    automaticJoins: [],
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

const emptyQuery = (data: unknown) => ({
  useQuery: () => ({
    data,
    isLoading: false,
    isError: false,
    error: null,
  }),
});

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scimToken: { list: { invalidate: vi.fn() } },
      scimReconciliation: { invalidate: vi.fn() },
    }),
    scimToken: {
      list: { useQuery: () => ({ data: [] }) },
      generate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: { connections: [], recentChanges: [] },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    // The four tab counts. Each is the same read its own tab runs, so the
    // number on a closed tab can never disagree with the list behind it.
    group: { listAll: emptyQuery([]) },
    team: { getTeamsWithRoleBindings: emptyQuery([]) },
    organization: {
      getOrganizationWithMembersAndTheirTeams: emptyQuery({ members: [] }),
      getOrganizationPendingInvites: emptyQuery([]),
    },
    joinRequests: { pending: emptyQuery([]) },
  },
}));

const DirectoryPage = (await import("../directory")).default;

function renderPage(initialEntry = "/settings/directory") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ChakraProvider value={defaultSystem}>
        <DirectoryPage />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

/** The tab labels carry their counts, so every lookup is by prefix. */
const tab = (label: string) =>
  screen.getByRole("tab", { name: RegExp(`^${label}`) });
const noTab = (label: string) =>
  screen.queryByRole("tab", { name: RegExp(`^${label}`) });

describe("given the directory page", () => {
  beforeEach(() => {
    state.permissions = new Set([
      "sso:view",
      "sso:manage",
      "organization:manage",
    ]);
    state.departments = [];
  });
  afterEach(() => cleanup());

  describe("when an administrator opens it", () => {
    /** @scenario The page leads with whether it is working */
    it("puts the status above the tabs, so every tab is read against it", () => {
      renderPage();

      const summary = screen.getByTestId("directory-summary");
      expect(
        summary.compareDocumentPosition(tab("People")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario The directory's people tab opens on everybody */
    it("opens on the people", () => {
      renderPage();

      expect(tab("People")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("people-section")).toBeInTheDocument();
    });

    /** @scenario The rules are not on the page about the people they admit */
    it("carries neither of the rules that admit people", () => {
      renderPage();

      // Who may join and what everybody must prove are both conditions of
      // getting in, so both are asked on Authentication beside the connection
      // they interact with. This page lists who is already here.
      expect(screen.queryByTestId("join-policy-card")).toBeNull();
      expect(screen.queryByTestId("two-step-requirement-card")).toBeNull();
    });

    /** @scenario The tabs name the subjects this page owns */
    it("offers people, teams and groups as three tabs", () => {
      renderPage();

      expect(tab("People")).toBeInTheDocument();
      expect(tab("Teams")).toBeInTheDocument();
      expect(tab("Groups")).toBeInTheDocument();
      // Provisioning moved to Authentication: whether a connector is syncing
      // is about how people ARRIVE, and this page answers who arrived.
      expect(noTab("Provisioning")).toBeNull();
    });

    /** @scenario A tab that names a count names it the same way as its siblings */
    it("carries a zero on a tab with nothing behind it", () => {
      renderPage();

      // A zero is an answer, and it is the one somebody checking on a quiet
      // week came to read.
      expect(tab("Groups")).toHaveAccessibleName(/0/);
      expect(tab("Teams")).toHaveAccessibleName(/0/);
    });
  });

  describe("when the address names a tab that has moved away", () => {
    /** @scenario The old directory sync address forwards onto the page it became */
    it("opens on the people rather than an empty tab", () => {
      renderPage("/settings/directory?tab=provisioning");

      expect(tab("People")).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("when the address names the groups tab", () => {
    /** @scenario The groups tab holds the hand-made ones as well as the sent ones */
    it("opens on the groups, which is where the old address forwards to", () => {
      renderPage("/settings/directory?tab=groups");

      expect(tab("Groups")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("groups-section")).toBeInTheDocument();
    });
  });

  describe("when the address names the teams tab", () => {
    /** @scenario The old teams address forwards onto the tab it became */
    it("opens on the teams and projects", () => {
      renderPage("/settings/directory?tab=teams");

      expect(tab("Teams")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("teams-section")).toBeInTheDocument();
    });
  });

  describe("when the organization has departments and the reader may view governance", () => {
    beforeEach(() => {
      state.permissions.add("governance:view");
      state.departments = [
        { id: "dep_eng", name: "Engineering" },
        { id: "dep_sales", name: "Sales" },
      ];
    });

    /** @scenario The departments tab joins only where there is anything to put on it */
    it("offers the departments tab with its count", () => {
      renderPage();

      expect(tab("Departments")).toHaveAccessibleName(/2/);
    });

    /** @scenario The departments tab references what Governance manages */
    it("opens on the departments when the address names them", () => {
      renderPage("/settings/directory?tab=departments");

      expect(tab("Departments")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("departments-section")).toBeInTheDocument();
    });
  });

  describe("when the organization has departments the reader may not view", () => {
    beforeEach(() => {
      // organization:manage without governance:view: the departments queries
      // would be refused, so the tab simply never appears.
      state.departments = [{ id: "dep_eng", name: "Engineering" }];
    });

    /** @scenario A reader who may not view governance is offered no departments tab */
    it("never offers the tab, and an address naming it lands on the people", () => {
      renderPage("/settings/directory?tab=departments");

      expect(noTab("Departments")).toBeNull();
      expect(tab("People")).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("when the reader may see the sync but not manage the organization", () => {
    /** @scenario A reader who may not read groups is told nothing they cannot have */
    /** @scenario A reader who may not read membership is not shown a roster */
    it("refuses the page rather than offering tabs that would all be empty", () => {
      state.permissions = new Set(["sso:view"]);
      renderPage();

      // Every tab reads membership now that provisioning has moved, so there
      // is no half of this page such a reader can have.
      expect(noTab("Groups")).toBeNull();
      expect(noTab("People")).toBeNull();
      expect(noTab("Teams")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Directory" })).toBeNull();
    });
  });

  describe("when the reader may manage the organization but not see the sync", () => {
    it("keeps the tabs and drops only the band that reads the sync", () => {
      state.permissions = new Set(["organization:manage"]);
      renderPage("/settings/directory?tab=groups");

      expect(screen.getByTestId("groups-section")).toBeInTheDocument();
      // The status band reads the sync, which this reader may not.
      expect(screen.queryByTestId("directory-summary")).toBeNull();
    });
  });

  describe("when the reader holds neither permission", () => {
    it("refuses the page rather than drawing an empty one", () => {
      state.permissions = new Set();
      renderPage();

      expect(noTab("People")).toBeNull();
      expect(screen.queryByTestId("groups-section")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Directory" })).toBeNull();
    });
  });
});
