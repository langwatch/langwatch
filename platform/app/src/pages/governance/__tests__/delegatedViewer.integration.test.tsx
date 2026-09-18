/**
 * @vitest-environment jsdom
 *
 * The delegated-viewer path through Governance, driven end to end: a real
 * permission set goes into `useOrganizationTeamProject`, the real
 * `withPermissionGuard` decides whether the page opens, and the real page
 * decides which panels render and which controls it offers.
 *
 * Only the boundaries are mocked - the layout chrome, the feature flag, the
 * router, the plan, and the tRPC client. Nothing about the permission
 * decision is: `hasAnyPermission` runs the same `hasPermissionWithHierarchy`
 * the server-side table uses, so a test that passes here cannot pass by
 * disagreeing with the RBAC rule.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOrganizationRolePermissions,
  getTeamRolePermissions,
} from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** Per-procedure answers, keyed by dotted path; undefined otherwise. */
  data: {} as Record<string, unknown>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/enterprise/EnterpriseLockedSurface", () => ({
  EnterpriseLockedSurface: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock("~/components/governance/QuarantineFillAlert", () => ({
  QuarantineFillAlert: () => null,
}));

// The lit ground behind the overview's hero runs a WebGL shader, and jsdom has
// no canvas to give it. Left real it throws from a timer after the test that
// mounted it has already passed.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/components/me/InstallCliCard", () => ({
  InstallCliCard: () => null,
}));

// The overview's hero mounts the inline command palette and the greeting;
// neither is what this test is about, and both reach providers it does not
// stand up (specs/ai-governance/dashboard/governance-overview-hero.feature).
vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: ({ placeholder }: { placeholder: string }) => (
    <input placeholder={placeholder} />
  ),
}));
vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: { askLangy: () => void }) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));
vi.mock("~/components/home/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1>Good morning</h1>,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { id: "src-1" },
    pathname: "/governance",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (path: string) => ({
    data: harness.data[path],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false)
                harness.requested.push(path.join("."));
              return queryResult(path.join("."));
            };
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import AnomalyRulesPage from "@ee/governance/dashboard/pages/anomaly-rules";
import IngestionSourceDetailPage from "@ee/governance/dashboard/pages/ingestion-source-detail";
import InventoryPage from "@ee/governance/dashboard/pages/inventory";

import AgentsPage from "../agents";
import GovernanceOverviewPage from "../index";
import PeoplePage from "../people";
import TeamsListPage from "../teams";
import TeamDetailPage from "../teams/[id]";
import UsersListPage from "../users";
import UserDetailPage from "../users/[id]";

/** Every page the Governance section navigation lists, plus its drill-ins. */
const GOVERNANCE_PAGES: Array<[string, React.ComponentType]> = [
  ["/governance", GovernanceOverviewPage],
  // The inventory carries both the Sources tab (the old catalog page) and
  // the Catalog tab (the old tool-catalog page) — one entry covers both.
  ["/governance/inventory", InventoryPage],
  ["/governance/inventory/:id", IngestionSourceDetailPage],
  // Anomaly rules and the users listing no longer have their own routes
  // (they redirect to a tab), but the page modules still mount for anyone
  // who reaches them, so they stay covered.
  ["/governance/anomaly-rules", AnomalyRulesPage],
  ["/governance/people", PeoplePage],
  ["/governance/agents", AgentsPage],
  ["/governance/teams", TeamsListPage],
  ["/governance/teams/:id", TeamDetailPage],
  ["/governance/users", UsersListPage],
  ["/governance/users/:id", UserDetailPage],
];

/**
 * The production shape of a delegated viewer: the `organization:view` floor
 * every org member holds, plus the one grant the Governance product is offered
 * on. Nothing that manages anything.
 */
const DELEGATED_VIEWER = ["organization:view", "governance:view"];

/**
 * What a customer's org admin actually holds, taken from the real tables
 * rather than restated: the organization ADMIN bag, plus the team ADMIN bag
 * they pick up through their team membership. Both are needed because the
 * resource families are split - `routingPolicies:*` lives in the team table
 * and `governance:*` in the organization one, and the hook routes each to its
 * own resolver (`isOrgScopedPermission`).
 *
 * The roles are passed as literal values rather than through the enums: those
 * live in the generated database client, and naming that module in this file
 * would move it into the datastore CI lane
 * (`src/test-utils/integrationLanes.ts` decides the lane from the file's own
 * source), which this test does not need.
 */
const ORGANIZATION_ADMIN: string[] = [
  ...getOrganizationRolePermissions(
    "ADMIN" as Parameters<typeof getOrganizationRolePermissions>[0],
  ),
  ...getTeamRolePermissions(
    "ADMIN" as Parameters<typeof getTeamRolePermissions>[0],
  ),
];

function renderPage({
  Page,
  initialEntry = "/governance",
}: {
  Page: React.ComponentType;
  initialEntry?: string;
}) {
  // The inventory page reads its ?tab= from the router's search params, so
  // every page mounts inside a memory router; the compat next-router stays
  // mocked above.
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Page />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  // The section keeps ONE sample choice for the whole sitting, in session
  // storage, so a test that presses the toggle would otherwise hand its
  // answer to the next one.
  window.sessionStorage.clear();
  harness.permissions = [...DELEGATED_VIEWER];
  harness.requested = [];
  harness.data = {};
});

afterEach(() => cleanup());

describe("governance pages for a delegated viewer", () => {
  describe("when the viewer holds governance:view and nothing else", () => {
    /** @scenario "Every Governance page opens for a governance:view holder" */
    it.each(GOVERNANCE_PAGES)("opens %s", (_route, Page) => {
      renderPage({ Page });
      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
    });

    /** @scenario "The overview holds nothing a delegated viewer is refused" */
    /** @scenario "Top-level /governance renders the dashboard" */
    it("names no missing grant on the overview and renders its heading and hero", () => {
      renderPage({ Page: GovernanceOverviewPage });

      // Nothing on the overview asks for a grant any more, so there is no
      // notice to read - and no panel missing behind one either.
      expect(
        screen.queryByText(/activityMonitor:view/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Ask an organization admin to grant you/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "AI Governance" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(screen.getByText("Insights")).toBeInTheDocument();
      // The one control the hero gates: this viewer holds no
      // `ingestionSources:manage`, and the inventory would drop the add link
      // it leads to, so the pill is not drawn at all.
      expect(screen.queryByText("Add Source")).not.toBeInTheDocument();
    });

    /** @scenario "The overview holds nothing a delegated viewer is refused" */
    it("sends no panel query at all", () => {
      renderPage({ Page: GovernanceOverviewPage });

      // The overview reads nothing of its own now, so the whole recorded
      // list is empty rather than only the activity-monitor slice of it.
      // (That the recorder itself works is exercised by the sibling tests
      // below, which assert a page DID issue its read.)
      expect(harness.requested).toEqual([]);
    });

    /** @scenario "Departments offers no controls a viewer cannot use" */
    it("offers no department controls without governance:manage", () => {
      // Departments live on the People page's second tab.
      renderPage({
        Page: PeoplePage,
        initialEntry: "/governance/people?tab=departments",
      });

      // Creating a department is now a header action opening a dialog, so the
      // control a viewer must not see is the button, not a text box.
      expect(
        screen.queryByRole("button", { name: /Add department/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Actions for/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/governance:manage/)).toBeInTheDocument();
    });

    // The pane's grant changed with the pane. It used to be the tile editor,
    // gated on `aiTools:manage`; it is now the registered-tools catalog, built
    // from the source list, so the grant it names is `ingestionSources:view` —
    // which this viewer does not hold. Naming it matters more here than it did
    // for the tiles: with no gate the pane would fall through to its "no tools
    // registered yet" empty state and tell this viewer their organization runs
    // no AI at all.
    /** @scenario "The inventory Catalog pane names its own grant" */
    it("names ingestionSources:view on the inventory Catalog pane and claims no empty estate", () => {
      renderPage({
        Page: InventoryPage,
        initialEntry: "/governance/inventory?tab=catalog",
      });

      expect(screen.getByText(/ingestionSources:view/)).toBeInTheDocument();
      expect(screen.queryByText(/No tools registered yet/)).toBeNull();
      // The retired editor is gone from this page for every viewer.
      expect(screen.queryByText("Tool Tiles")).not.toBeInTheDocument();
    });
  });

  describe("when the viewer can read anomaly rules but not manage them", () => {
    /** @scenario "Anomaly rules offers no controls a viewer cannot use" */
    it("offers no rule authoring controls", () => {
      harness.permissions = [...DELEGATED_VIEWER, "anomalyRules:view"];
      renderPage({ Page: AnomalyRulesPage });

      expect(
        screen.queryByRole("button", { name: /New rule/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/anomalyRules:manage/)).toBeInTheDocument();
      expect(harness.requested).toContain("anomalyRules.list");
    });
  });

  describe("when the viewer can read ingestion sources but not manage them", () => {
    /** @scenario "The sources tab offers no controls a viewer cannot use" */
    it("offers no source authoring controls", () => {
      harness.permissions = [...DELEGATED_VIEWER, "ingestionSources:view"];
      // Addressed rather than defaulted: the inventory opens on Catalog now,
      // and the write notice under test lives on the Sources pane.
      renderPage({
        Page: InventoryPage,
        initialEntry: "/governance/inventory?tab=sources",
      });

      expect(
        screen.queryByRole("button", { name: /Add source/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/ingestionSources:manage/)).toBeInTheDocument();
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when the viewer is an org ADMIN", () => {
    // The admin path is what every existing customer sees, and the panels
    // were re-grouped to make the delegated path work. This is what says the
    // regrouping did not take anything away from the admin.
    /** @scenario "An org admin meets the same overview a delegated viewer does" */
    it("meets the same hero and sections, with no panel and no read", () => {
      harness.permissions = ORGANIZATION_ADMIN;
      renderPage({ Page: GovernanceOverviewPage });

      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add people" })).toBeVisible();
      expect(screen.getByText("Insights")).toBeInTheDocument();
      expect(screen.getByText("Recent activity")).toBeInTheDocument();
      // The admin can add a source, so the admin is the one offered the pill.
      expect(screen.getByText("Add Source")).toBeInTheDocument();
      expect(
        screen.queryByText(/Ask an organization admin to grant you/),
      ).not.toBeInTheDocument();

      // The panels moved to the pages that own them, so the admin's overview
      // reads exactly as much as the delegated viewer's: nothing.
      expect(screen.queryByText("Recent anomalies")).not.toBeInTheDocument();
      expect(screen.queryByText("Ingestion sources")).not.toBeInTheDocument();
      expect(screen.queryByText("CLI session policy")).not.toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });

    /** @scenario "An org admin still sees the department write controls" */
    it("offers the department write controls", () => {
      harness.permissions = ORGANIZATION_ADMIN;
      renderPage({
        Page: PeoplePage,
        initialEntry: "/governance/people?tab=departments",
      });

      expect(
        screen.getByRole("button", { name: /Add department/ }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Ask an organization admin to grant you/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the viewer can manage the organization but not read governance", () => {
    // The built-in ADMIN role holds both, which
    // `governancePageGuards.unit.test.ts` pins. This is the synthetic case the
    // guard swap could have regressed, and it documents the answer: the guard
    // asks for `governance:view`, so this principal is refused - the same
    // refusal the routers already give it.
    /** @scenario "A principal who manages the organization but cannot read governance is refused" */
    it("is refused, consistently with the routers", () => {
      harness.permissions = ["organization:manage"];
      renderPage({ Page: GovernanceOverviewPage });

      expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    });
  });
});
