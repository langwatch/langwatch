// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment jsdom
 *
 * The delegated-viewer path through Governance, driven end to end: a real
 * permission set goes into the governance host, and the real page decides
 * which panels render and which controls it offers.
 *
 * Only one boundary is mocked — the tRPC client. Everything the platform
 * suite mocked module by module (the session hook, the feature flag, the
 * plan, the router, the layout chrome) is now one test double answering
 * `GovernanceHostPort`, which is the seam the screens were rewritten onto.
 * Nothing about the permission decision is faked: the double resolves grants
 * through `permissionSatisfiedBy`, the authz contract's own hierarchy rule,
 * so a test that passes here cannot pass by disagreeing with the rule the
 * server-side table applies.
 *
 * WHAT IS NO LONGER HERE. `withPermissionGuard` and `withFeatureFlagGuard`
 * used to wrap these pages and this file drove them: whether a principal was
 * let in at all, and the "Access Restricted" surface they saw when they were
 * not. That policy now lives in `apps/ui` (`withUiPageGuard`, applied in
 * `apps/ui/src/features/governance/ui/sections/governance-routes.tsx`), which
 * is where its tests belong — this package's screens do not check
 * `governance:view` and would render for anyone. So the first scenario below
 * is carried for the half that IS this package's — that a viewer holding only
 * `governance:view` gets a rendered page rather than a collapsed one — and the
 * refusal half is named in the report rather than asserted here with nothing
 * behind it.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinRolePermissions } from "@langwatch/authz-contract";
import {
  fakeGovernanceHost,
  renderWithGovernanceHost,
  type GovernanceQuery,
} from "../../../testing";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

vi.mock("../../../behavior/governance-api", () => {
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
          // The utils client's imperative methods are called, not walked, so
          // they have to be functions rather than another proxy node.
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property))
            return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  const api = node([]);
  return { api, governanceApi: api };
});

import AnomalyRulesPage from "../governance-anomaly-rules.screen";
import IngestionSourceDetailPage from "../governance-ingestion-source.screen";
import InventoryPage from "../governance-inventory.screen";

import GovernanceOverviewPage from "../governance-overview.screen";
import PeoplePage from "../governance-people.screen";
import TeamDetailPage from "../governance-team.screen";
import TeamsListPage from "../governance-teams.screen";
import UserDetailPage from "../governance-user.screen";
import UsersListPage from "../governance-users.screen";

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
 * and `governance:*` in the organization one, and the host resolves each
 * against one flat set.
 *
 * The bags come from `@langwatch/authz-contract` rather than from the
 * application's `rbac.ts`, which a feature-web package may not import. They
 * are the same lists: `getOrganizationRolePermissions("ADMIN")` and
 * `getTeamRolePermissions("ADMIN")` are both deprecated in favour of exactly
 * these two calls.
 */
const ORGANIZATION_ADMIN: string[] = [
  ...builtinRolePermissions("org-admin"),
  ...builtinRolePermissions("admin"),
];

function renderPage({
  Page,
  permissions,
  query,
}: {
  Page: React.ComponentType;
  permissions: readonly string[];
  query?: GovernanceQuery;
}) {
  const host = fakeGovernanceHost({
    permissions,
    // The source-detail, team and user pages read their row id off the
    // address, the way the platform suite's compat-router mock supplied it.
    params: { id: "src-1" },
    ...(query ? { query } : {}),
  });
  renderWithGovernanceHost(<Page />, { host });
  return host;
}

beforeEach(() => {
  harness.requested = [];
});

afterEach(() => cleanup());

describe("governance pages for a delegated viewer", () => {
  describe("when the viewer holds governance:view and nothing else", () => {
    /**
     * Carries the scenario's package half only: that the page renders for a
     * viewer holding nothing but `governance:view`. Whether such a viewer is
     * let through the door at all is `apps/ui`'s guard, and its test.
     */
    /** @scenario "Every Governance page opens for a governance:view holder" */
    it.each(GOVERNANCE_PAGES)("opens %s", (_route, Page) => {
      renderPage({ Page, permissions: DELEGATED_VIEWER });
      expect(screen.getByTestId("section-navigation-layout")).toBeTruthy();
    });

    /** @scenario "The overview names the grant a refused panel needs" */
    it("names activityMonitor:view on the overview and still renders the rest", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: DELEGATED_VIEWER });

      expect(screen.getByText(/activityMonitor:view/)).toBeTruthy();
      // The page did not collapse into the notice: its own heading and the
      // panels that need no activity-monitor grant are still there.
      expect(screen.getByRole("heading", { name: "AI Governance" })).toBeTruthy();
      expect(screen.getByText("CLI session policy")).toBeTruthy();
    });

    /** @scenario "A panel query is not sent when the viewer cannot read it" */
    it("sends no activity-monitor query", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: DELEGATED_VIEWER });

      expect(harness.requested.filter((path) => path.startsWith("activityMonitor."))).toEqual([]);
      // The grants it DOES hold are still read, so the page is not simply
      // querying nothing.
      expect(harness.requested).toContain("sessionPolicy.get");
    });

    /** @scenario "Departments offers no controls a viewer cannot use" */
    it("offers no department controls without governance:manage", () => {
      renderPage({ Page: PeoplePage, permissions: DELEGATED_VIEWER });

      expect(screen.queryByText("Create a department")).toBeNull();
      expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
      expect(screen.getByText(/governance:manage/)).toBeTruthy();
    });

    /** @scenario "The inventory Catalog pane names its own grant" */
    it("names aiTools:manage on the inventory Catalog pane and renders no editor", () => {
      renderPage({
        Page: InventoryPage,
        permissions: DELEGATED_VIEWER,
        query: { tab: "catalog" },
      });

      expect(screen.getByText(/aiTools:manage/)).toBeTruthy();
      expect(screen.queryByText("Tool Tiles")).toBeNull();
    });
  });

  describe("when the viewer can read anomaly rules but not manage them", () => {
    /** @scenario "Anomaly rules offers no controls a viewer cannot use" */
    it("offers no rule authoring controls", () => {
      renderPage({
        Page: AnomalyRulesPage,
        permissions: [...DELEGATED_VIEWER, "anomalyRules:view"],
      });

      expect(screen.queryByRole("button", { name: /New rule/ })).toBeNull();
      expect(screen.getByText(/anomalyRules:manage/)).toBeTruthy();
      expect(harness.requested).toContain("anomalyRules.list");
    });
  });

  describe("when the viewer can read ingestion sources but not manage them", () => {
    /** @scenario "The sources tab offers no controls a viewer cannot use" */
    it("offers no source authoring controls", () => {
      renderPage({
        Page: InventoryPage,
        permissions: [...DELEGATED_VIEWER, "ingestionSources:view"],
      });

      expect(screen.queryByRole("button", { name: /Add source/ })).toBeNull();
      expect(screen.getByText(/ingestionSources:manage/)).toBeTruthy();
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when the viewer is an org ADMIN", () => {
    // The admin path is what every existing customer sees, and the panels
    // were re-grouped to make the delegated path work. This is what says the
    // regrouping did not take anything away from the admin.
    /** @scenario "An org admin still sees every panel on the overview" */
    it("renders every panel and names no missing grant", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: ORGANIZATION_ADMIN });

      expect(screen.getByText("Top teams by spend")).toBeTruthy();
      expect(screen.getByText("Top users by spend")).toBeTruthy();
      expect(screen.getByText("Spend by department")).toBeTruthy();
      expect(screen.getByText("Recent anomalies")).toBeTruthy();
      expect(screen.getByText("Ingestion sources")).toBeTruthy();
      expect(screen.getByText("CLI session policy")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).toBeNull();

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
      renderPage({ Page: PeoplePage, permissions: ORGANIZATION_ADMIN });

      expect(screen.getByText("Create a department")).toBeTruthy();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).toBeNull();
    });
  });
});
