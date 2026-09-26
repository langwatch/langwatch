import { builtinRolePermissions } from "@langwatch/authz-contract";
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
 * `GovernanceHostApi`, which is the seam the screens were rewritten onto.
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

import {
  fakeGovernanceHost,
  renderWithGovernanceHost,
  type GovernanceQuery,
} from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

// The overview's hero mounts the inline command palette, which reaches a
// provider this test does not stand up; main mocks the same seam, and the
// shader behind the hero, which jsdom has no canvas for.
vi.mock("@langwatch/navigation-browser/surfaces/command-bar", () => ({
  CommandPalette: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));
vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));
vi.mock("../../../../features/overview/ui/sections/quarantine-fill-panel.tsx", () => ({
  QuarantineFillAlert: () => null,
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
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

import AnomalyRulesPage from "../governance-anomaly-rules.screen.tsx";
import IngestionSourceDetailPage from "../governance-ingestion-source.screen.tsx";
import InventoryPage from "../governance-inventory.screen.tsx";
import GovernanceOverviewPage from "../governance-overview.screen.tsx";
import PeoplePage from "../governance-people.screen.tsx";
import TeamDetailPage from "../governance-team.screen.tsx";
import TeamsListPage from "../governance-teams.screen.tsx";
import UserDetailPage from "../governance-user.screen.tsx";
import UsersListPage from "../governance-users.screen.tsx";

/** Every page the Governance section navigation lists, plus its drill-ins. */
const GOVERNANCE_PAGES: [string, React.ComponentType][] = [
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

    /** @scenario "The overview holds nothing a delegated viewer is refused" */
    it("names no missing grant on the overview and renders its heading and hero", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: DELEGATED_VIEWER });

      expect(screen.queryByText(/activityMonitor:view/)).toBeNull();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).toBeNull();
      expect(screen.getByRole("heading", { name: "AI Governance" })).toBeTruthy();
      expect(screen.getByText("Insights")).toBeTruthy();
      // No `ingestionSources:manage`, so the hero draws no add-source pill.
      expect(screen.queryByText("Add source")).toBeNull();
    });

    /** @scenario "The overview holds nothing a delegated viewer is refused" */
    it("sends no panel query at all", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: DELEGATED_VIEWER });

      expect(harness.requested).toEqual([]);
    });

    /** @scenario "Departments offers no controls a viewer cannot use" */
    it("offers no department controls without governance:manage", () => {
      renderPage({
        Page: PeoplePage,
        permissions: DELEGATED_VIEWER,
        query: { tab: "departments" },
      });

      expect(screen.queryByRole("button", { name: /Add department/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
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
      // Addressed rather than defaulted: the inventory opens on Catalog, and the
      // write notice under test lives on the Sources pane.
      renderPage({
        Page: InventoryPage,
        permissions: [...DELEGATED_VIEWER, "ingestionSources:view"],
        query: { tab: "sources" },
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
    /** @scenario "An org admin meets the same overview a delegated viewer does" */
    it("meets the same hero and sections, with no panel and no read", () => {
      renderPage({ Page: GovernanceOverviewPage, permissions: ORGANIZATION_ADMIN });

      expect(screen.getByRole("link", { name: "Add department" })).toBeVisible();
      expect(screen.getByText("Insights")).toBeTruthy();
      expect(screen.getByText("Recent activity")).toBeTruthy();
      // The admin can add a source, so the admin is the one offered the pill.
      expect(screen.getByText("Add source")).toBeTruthy();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).toBeNull();

      // The panels moved to the pages that own them: the overview reads nothing.
      expect(screen.queryByText("Recent anomalies")).toBeNull();
      expect(screen.queryByText("Ingestion sources")).toBeNull();
      expect(screen.queryByText("CLI session policy")).toBeNull();
      expect(harness.requested).toEqual([]);
    });

    /** @scenario "An org admin still sees the department write controls" */
    it("offers the department write controls", () => {
      renderPage({
        Page: PeoplePage,
        permissions: ORGANIZATION_ADMIN,
        query: { tab: "departments" },
      });

      expect(screen.getByRole("button", { name: /Add department/ })).toBeTruthy();
      expect(screen.queryByText(/Ask an organization admin to grant you/)).toBeNull();
    });
  });
});
