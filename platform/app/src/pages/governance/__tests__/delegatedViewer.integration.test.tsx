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

import { getOrganizationRolePermissions, getTeamRolePermissions } from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac = await vi.importActual<typeof import("~/server/api/rbac")>("~/server/api/rbac");
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
  EnterpriseLockedSurface: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/governance/QuarantineFillAlert", () => ({
  QuarantineFillAlert: () => null,
}));

vi.mock("~/components/me/InstallCliCard", () => ({
  InstallCliCard: () => null,
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
  const queryResult = () => ({
    data: undefined,
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
              if (options?.enabled !== false) harness.requested.push(path.join("."));
              return queryResult();
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

import AnomalyRulesPage from "../anomaly-rules.enterprise";
import IngestionSourceDetailPage from "../ingestion-source-detail.enterprise";
import InventoryPage from "../inventory.enterprise";

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
  ["/governance/anomaly-rules", AnomalyRulesPage],
  ["/governance/people", PeoplePage],
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
  ...getTeamRolePermissions("ADMIN" as Parameters<typeof getTeamRolePermissions>[0]),
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
  harness.permissions = [...DELEGATED_VIEWER];
  harness.requested = [];
});

afterEach(() => cleanup());

describe("governance pages for a delegated viewer", () => {
  describe("when the viewer holds governance:view and nothing else", () => {
    /** @scenario "Every Governance page opens for a governance:view holder" */
    it.each(GOVERNANCE_PAGES)("opens %s", (_route, Page) => {
      renderPage({ Page });
      expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
    });

    /** @scenario "The overview names the grant a refused panel needs" */
    it("names activityMonitor:view on the overview and still renders the rest", () => {
      renderPage({ Page: GovernanceOverviewPage });

      expect(screen.getByText(/activityMonitor:view/)).toBeInTheDocument();
      // The page did not collapse into the notice: its own heading and the
      // panels that need no activity-monitor grant are still there.
      expect(screen.getByRole("heading", { name: "AI Governance" })).toBeInTheDocument();
      expect(screen.getByText("CLI session policy")).toBeInTheDocument();
    });

    /** @scenario "A panel query is not sent when the viewer cannot read it" */
    it("sends no activity-monitor query", () => {
      renderPage({ Page: GovernanceOverviewPage });

      expect(harness.requested.filter((path) => path.startsWith("activityMonitor."))).toEqual([]);
      // The grants it DOES hold are still read, so the page is not simply
      // querying nothing.
      expect(harness.requested).toContain("sessionPolicy.get");
    });

    /** @scenario "Departments offers no controls a viewer cannot use" */
    it("offers no department controls without governance:manage", () => {
      renderPage({ Page: PeoplePage });

      expect(screen.queryByText("Create a department")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
      expect(screen.getByText(/governance:manage/)).toBeInTheDocument();
    });

    /** @scenario "The inventory Catalog pane names its own grant" */
    it("names aiTools:manage on the inventory Catalog pane and renders no editor", () => {
      renderPage({
        Page: InventoryPage,
        initialEntry: "/governance/inventory?tab=catalog",
      });

      expect(screen.getByText(/aiTools:manage/)).toBeInTheDocument();
      expect(screen.queryByText("Tool Tiles")).not.toBeInTheDocument();
    });
  });

  describe("when the viewer can read anomaly rules but not manage them", () => {
    /** @scenario "Anomaly rules offers no controls a viewer cannot use" */
    it("offers no rule authoring controls", () => {
      harness.permissions = [...DELEGATED_VIEWER, "anomalyRules:view"];
      renderPage({ Page: AnomalyRulesPage });

      expect(screen.queryByRole("button", { name: /New rule/ })).not.toBeInTheDocument();
      expect(screen.getByText(/anomalyRules:manage/)).toBeInTheDocument();
      expect(harness.requested).toContain("anomalyRules.list");
    });
  });

  describe("when the viewer can read ingestion sources but not manage them", () => {
    /** @scenario "The sources tab offers no controls a viewer cannot use" */
    it("offers no source authoring controls", () => {
      harness.permissions = [...DELEGATED_VIEWER, "ingestionSources:view"];
      renderPage({ Page: InventoryPage });

      expect(screen.queryByRole("button", { name: /Add source/ })).not.toBeInTheDocument();
      expect(screen.getByText(/ingestionSources:manage/)).toBeInTheDocument();
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when the viewer is an org ADMIN", () => {
    // The admin path is what every existing customer sees, and the panels
    // were re-grouped to make the delegated path work. This is what says the
    // regrouping did not take anything away from the admin.
    /** @scenario "An org admin still sees every panel on the overview" */
    it("renders every panel and names no missing grant", () => {
      harness.permissions = ORGANIZATION_ADMIN;
      renderPage({ Page: GovernanceOverviewPage });

      expect(screen.getByText("Top teams by spend")).toBeInTheDocument();
      expect(screen.getByText("Top users by spend")).toBeInTheDocument();
      expect(screen.getByText("Spend by department")).toBeInTheDocument();
      expect(screen.getByText("Recent anomalies")).toBeInTheDocument();
      expect(screen.getByText("Ingestion sources")).toBeInTheDocument();
      expect(screen.getByText("CLI session policy")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).not.toBeInTheDocument();

      // Every panel's read is actually issued for an admin.
      expect(harness.requested).toContain("activityMonitor.summary");
      expect(harness.requested).toContain("ingestionSources.list");
      expect(harness.requested).toContain("routingPolicy.list");
      expect(harness.requested).toContain("anomalyRules.list");
      expect(harness.requested).toContain("aiTools.adminList");
      expect(harness.requested).toContain("sessionPolicy.get");
    });

    /** @scenario "An org admin still sees the department write controls" */
    it("offers the department write controls", () => {
      harness.permissions = ORGANIZATION_ADMIN;
      renderPage({ Page: PeoplePage });

      expect(screen.getByText("Create a department")).toBeInTheDocument();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).not.toBeInTheDocument();
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
