/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/navigation/specs/product-sidebars.feature
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  ProductDashboardsToken,
  type ProductDashboardsProps,
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
  type StarredDashboardsProps,
} from "@langwatch/analytics-client";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

/** `release_dashboards` as each project resolves it; `fallback` for a project not named. */
const dashboardsRelease: {
  byProject: Readonly<Record<string, boolean>>;
  fallback: boolean;
} = vi.hoisted(() => ({ byProject: {}, fallback: false }));

/** Whether the organization's flags open its Dashboards area. */
const organizationLibrary: { open: boolean } = vi.hoisted(() => ({ open: false }));

/**
 * The reader's own permissions as each project resolves them; `fallback` for a project not named.
 */
const grants: {
  byProject: Readonly<Record<string, readonly string[]>>;
  fallback: readonly string[];
} = vi.hoisted(() => ({ byProject: {}, fallback: [] }));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

/** The server's flag answer per project; a read this browser's `?ff_` override holds gets none. */
vi.mock("@langwatch/api/web", async (importOriginal) => {
  const original = await importOriginal<{ createModuleApi: () => object }>();
  const featureFlag = {
    isEnabled: {
      useQuery: (
        { flag, projectId }: { flag: string; projectId?: string | null },
        { enabled }: { enabled: boolean },
      ) => ({
        data: enabled
          ? {
              enabled:
                flag === "release_dashboards" &&
                (dashboardsRelease.byProject[projectId ?? ""] ?? dashboardsRelease.fallback),
            }
          : undefined,
        isLoading: false,
      }),
    },
  };
  return {
    ...original,
    createModuleApi: () =>
      new Proxy(original.createModuleApi(), {
        get: (target, key) => (key === "featureFlag" ? featureFlag : Reflect.get(target, key)),
      }),
  };
});

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({ data: { count: 0 } }) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    limits: { getUsage: { useQuery: () => ({}) } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({
          data: { enabledByOrganizationId: { "organization-1": organizationLibrary.open } },
          isLoading: false,
        }),
      },
    },
    authz: {
      effectivePermissions: {
        useQuery: ({ projectId }: { projectId: string }) => ({
          data: { permissions: grants.byProject[projectId] ?? grants.fallback },
        }),
      },
    },
  },
}));

import {
  applyFeatureFlagOverridesFromSearch,
  clearAllFeatureFlagOverrides,
} from "@langwatch/feature-flag-client";
import { pickFlagDefinition } from "@langwatch/feature-flag-contract";
import type {
  NavigationOrganization,
  NavigationProject,
  NavigationTeam,
} from "@langwatch/navigation-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductSidebar } from "../product-sidebar.tsx";

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };
const SHOP: NavigationProject = { id: "project-shop", slug: "shop", name: "Shop" };
const PERSONAL: NavigationProject = {
  id: "project-mine",
  slug: "my-workspace",
  name: "My workspace",
  isPersonal: true,
};
const SHOP_TEAM: NavigationTeam = { id: "team-shop", name: "Shop team", projects: [SHOP] };
const PERSONAL_TEAM: NavigationTeam = {
  id: "team-mine",
  name: "My workspace",
  isPersonal: true,
  projects: [PERSONAL],
};
const ORGANIZATION: NavigationOrganization = {
  id: "organization-1",
  name: "Demo organization",
  teams: [],
};

/** An organization creation date the given number of days before now, as the wire sends it. */
function createdDaysAgo(days: number): string {
  return Temporal.Instant.fromEpochMilliseconds(
    nowInstant().epochMilliseconds - days * 24 * 60 * 60 * 1000,
  ).toString();
}

/** Stands in for analytics' lent list, echoing the address it was told is open. */
function LentList({ openPath }: SavedDashboardsProps) {
  return <div data-testid="saved-dashboards">Saved dashboards open:{openPath || "none"}</div>;
}

/** Stands in for analytics' lent Dashboards section, echoing the project it was handed. */
function LentStarred({ project }: StarredDashboardsProps) {
  return (
    <div data-testid="starred-dashboards">
      {project ? `Pinned dashboards in ${project.name} (${project.id})` : "Pinned dashboards"}
    </div>
  );
}

/** Stands in for analytics' lent product Dashboards section, echoing its product. */
function LentProductDashboards({ product }: ProductDashboardsProps) {
  return <div data-testid="product-dashboards">Dashboards of {product}</div>;
}

const analyticsLends = uiDeclarations([
  {
    name: "analytics",
    installation: {
      capabilities: {},
      lends: [
        { token: SavedDashboardsToken, load: async () => ({ default: LentList }) },
        { token: StarredDashboardsToken, load: async () => ({ default: LentStarred }) },
        { token: ProductDashboardsToken, load: async () => ({ default: LentProductDashboards }) },
      ],
    },
  },
]);

/** What `release_dashboards_in_every_product` reads when nothing sets it. */
const EVERY_PRODUCT_DEFAULT =
  pickFlagDefinition("release_dashboards_in_every_product")?.defaultValue === true;

function renderSidebar({
  surface,
  pathname,
  permissions = ["analytics:view"],
  dashboardsFlag = true,
  dashboardsLoading = false,
  organizationLoading = false,
  kind,
  everyProductFlag = EVERY_PRODUCT_DEFAULT,
  project = kind ? { ...PROJECT, kind } : PROJECT,
  openableTeams,
  rememberedProjectSlug,
  dashboardsFlagByProject = {},
  permissionsByProject = {},
  organization = ORGANIZATION,
}: {
  surface: "llm-ops" | "dashboards" | "gateway" | "governance" | "me" | "settings";
  pathname: string;
  /** The page's own grants, and the grants in any project not named below. */
  permissions?: string[];
  /** The reader's own grants in a named project, by project id. */
  permissionsByProject?: Readonly<Record<string, readonly string[]>>;
  /** `release_dashboards` for the page's own scope, and for any project not named below. */
  dashboardsFlag?: boolean;
  /** `release_dashboards` resolved for a named project, by project id. */
  dashboardsFlagByProject?: Readonly<Record<string, boolean>>;
  dashboardsLoading?: boolean;
  organizationLoading?: boolean;
  kind?: string;
  /** `release_dashboards_in_every_product`; unset, it holds the registry default. */
  everyProductFlag?: boolean;
  project?: NavigationProject;
  openableTeams?: readonly NavigationTeam[];
  rememberedProjectSlug?: string;
  /** `null` while the page's organization has not arrived. */
  organization?: NavigationOrganization | null;
}) {
  declarations.current = analyticsLends;
  dashboardsRelease.byProject = dashboardsFlagByProject;
  dashboardsRelease.fallback = dashboardsFlag;
  grants.byProject = permissionsByProject;
  grants.fallback = permissions;
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project,
        pathname,
        permissions,
        isLoading: organizationLoading,
        ...(organization ? { organization } : {}),
        ...(openableTeams ? { openableTeams } : {}),
        ...(rememberedProjectSlug ? { rememberedProjectSlug } : {}),
        flags: {
          release_dashboards: { enabled: dashboardsFlag, isLoading: dashboardsLoading },
          release_dashboards_in_every_product: { enabled: everyProductFlag, isLoading: false },
        },
        commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: null },
      }}
    >
      <ProductSidebar surface={surface} isCompact={false} />
    </WithStubNavigationHost>,
  );
}

afterEach(() => {
  cleanup();
  clearAllFeatureFlagOverrides();
  declarations.current = undefined;
  organizationLibrary.open = false;
});

describe("the Dashboards product sidebar", () => {
  describe("given a board is open", () => {
    /** @scenario "AC3 Sidebar matches the reference" */
    it("holds only Quick Search and the saved-dashboards list, marking the open board", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards/agent-flight-deck" });

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent(
        "open:agent-flight-deck",
      );
      expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
      expect(screen.queryByText("Observe")).toBeNull();
      expect(screen.queryByText("Test")).toBeNull();
      expect(screen.queryByText("Build")).toBeNull();
    });
  });

  describe("given a From LangWatch board is open", () => {
    it("hands the whole address under the area to the list", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards/curated/release" });

      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent(
        "open:curated/release",
      );
    });
  });

  describe("given the area's own address", () => {
    it("marks no board as open", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards" });

      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent("open:none");
    });
  });
});

describe("the Dashboards sidebar in the organization's library", () => {
  describe("given the library is open", () => {
    /**
     * @scenario "The Dashboards sidebar at org level"
     * @scenario "No sidebar has a Starred dashboards group"
     */
    it("lists All dashboards as current, with no Templates and no starred group", async () => {
      organizationLibrary.open = true;
      renderSidebar({ surface: "dashboards", pathname: "/dashboards", everyProductFlag: true });

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "All dashboards" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.queryByRole("link", { name: "Templates" })).toBeNull();
      expect(screen.queryByText(/Starred/)).toBeNull();
      expect(screen.queryByTestId("saved-dashboards")).toBeNull();
      await expectNoSection();
    });
  });
});

describe("the LLM Ops sidebar", () => {
  describe("given the dashboards flag is on and the member holds analytics:view", () => {
    it("carries no Dashboards entry and no saved-dashboards list", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Dashboards" })).toBeNull();
      expect(screen.queryByTestId("saved-dashboards")).toBeNull();
    });
  });

  describe("given the Analytics entry", () => {
    /** @scenario "AC3b The Analytics entry opens Dashboards when the project can reach them" */
    it("opens Dashboards with no pill when Dashboards is reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/dashboards");
      expect(within(link).queryByText("Legacy")).toBeNull();
    });

    /** @scenario "AC3k The Analytics entry waits for the Dashboards answer" */
    it("shows no Analytics entry while the flag is still loading", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", dashboardsLoading: true });

      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
    });

    /** @scenario "AC3p The Analytics entry waits for the permission read as well" */
    it("shows no Analytics entry while the grant is still being read", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", organizationLoading: true });

      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
    });

    /** @scenario "AC3p The Analytics entry waits for the permission read as well" */
    it("never shows the analytics address on a project switch before the grant settles", () => {
      const view = renderSidebar({
        surface: "llm-ops",
        pathname: "/demo",
        permissions: [],
        organizationLoading: true,
      });
      const seen = () =>
        screen.queryByRole("link", { name: "Analytics" })?.getAttribute("href") ?? null;
      expect(seen()).toBeNull();

      view.unmount();
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });
      expect(seen()).toBe("/demo/dashboards");
    });

    /** @scenario "AC3q An aggregate project keeps the Analytics entry on analytics" */
    it("keeps an aggregate project on analytics even when Dashboards is reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics", kind: "aggregate" });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/analytics");
      expect(link).toHaveAttribute("aria-current", "page");
    });

    /** @scenario "AC3m The Analytics entry is not marked active on a legacy analytics page when it leads to Dashboards" */
    it("is not marked active on a legacy analytics page when it leads to Dashboards", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics" });

      expect(screen.getByRole("link", { name: "Analytics" })).not.toHaveAttribute("aria-current");
    });

    /** @scenario "AC3n The Analytics entry is marked active on a legacy analytics page when it leads to analytics" */
    it("is marked active on a legacy analytics page when it leads to analytics", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics", dashboardsFlag: false });

      expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    /** @scenario "AC3h The Analytics entry opens analytics when Dashboards is out of reach" */
    it("opens analytics with no pill when Dashboards is not reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", dashboardsFlag: false });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/analytics");
      expect(within(link).queryByText("Legacy")).toBeNull();
    });
  });

  describe("given an organization younger than three weeks", () => {
    const young = { ...ORGANIZATION, createdAt: createdDaysAgo(2) };

    /** @scenario "An organization younger than three weeks has no Analytics entry in Observe" */
    it("offers no Analytics entry where it leads to Dashboards", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", organization: young });

      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
      expect(screen.getByRole("link", { name: "Trace Explorer" })).toBeInTheDocument();
    });

    /** @scenario "A young organization keeps the Analytics entry where it opens the old Analytics" */
    it("keeps the entry where it opens the old Analytics", () => {
      renderSidebar({
        surface: "llm-ops",
        pathname: "/demo",
        organization: young,
        dashboardsFlag: false,
      });

      expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "href",
        "/demo/analytics",
      );
    });
  });

  describe("given an organization three weeks or older", () => {
    /** @scenario "An organization three weeks or older keeps the Analytics entry in Observe" */
    it("offers the Analytics entry, leading to Dashboards", () => {
      renderSidebar({
        surface: "llm-ops",
        pathname: "/demo",
        organization: { ...ORGANIZATION, createdAt: createdDaysAgo(30) },
      });

      expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "href",
        "/demo/dashboards",
      );
    });
  });
});

describe("the other products' sidebars once the organization's Dashboards area is on", () => {
  const otherProducts = [
    { surface: "gateway", pathname: "/gateway/virtual-keys", project: SHOP },
    { surface: "me", pathname: "/coding-agents", project: PERSONAL },
    { surface: "governance", pathname: "/governance", project: SHOP },
  ] as const;
  const shopRemembered = {
    openableTeams: [PERSONAL_TEAM, SHOP_TEAM],
    rememberedProjectSlug: "shop",
  } as const;

  describe("given the area is off, in Gateway", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it("keeps the project's Dashboards section", async () => {
      renderSidebar({
        surface: "gateway",
        pathname: "/gateway/virtual-keys",
        project: SHOP,
        everyProductFlag: true,
        ...shopRemembered,
      });

      expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
        "Pinned dashboards in Shop (project-shop)",
      );
    });
  });

  describe("given the area is off, in Governance", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it("draws no Dashboards section", async () => {
      renderSidebar({
        surface: "governance",
        pathname: "/governance",
        project: SHOP,
        everyProductFlag: true,
        ...shopRemembered,
      });

      await expectNoSection();
    });
  });

  describe("given the area is on, in each product", () => {
    /**
     * @scenario "Each product's sidebar lists its own boards"
     * @scenario "No sidebar has a Starred dashboards group"
     */
    it.each(otherProducts)(
      "lists $surface's own boards, with no starred group and no project's section",
      async ({ surface, pathname, project }) => {
        organizationLibrary.open = true;
        renderSidebar({ surface, pathname, project, everyProductFlag: true, ...shopRemembered });

        expect(await screen.findByTestId("product-dashboards")).toHaveTextContent(
          `Dashboards of ${surface}`,
        );
        expect(screen.queryByText(/Starred/)).toBeNull();
        await expectNoSection();
      },
    );

    /**
     * @scenario "The LLM Ops section in a project lists the same boards, filtered"
     * @scenario "No sidebar has a Starred dashboards group"
     */
    it("lists LLM Ops's own boards in place of the project's pinned section", async () => {
      organizationLibrary.open = true;
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(await screen.findByTestId("product-dashboards")).toHaveTextContent(
        "Dashboards of llm-ops",
      );
      expect(screen.queryByText(/Starred/)).toBeNull();
      await expectNoSection();
    });
  });

  describe("given the area is on but every product's flag is off", () => {
    /** @scenario "No sidebar has a Starred dashboards group" */
    it.each(otherProducts)(
      "draws no Dashboards section in $surface",
      async ({ surface, pathname, project }) => {
        organizationLibrary.open = true;
        renderSidebar({
          surface,
          pathname,
          project,
          everyProductFlag: false,
          ...shopRemembered,
        });

        await expect(
          screen.findByTestId("product-dashboards", {}, { timeout: 300 }),
        ).rejects.toThrow("Unable to find an element");
        await expectNoSection();
      },
    );
  });
});

/** The lent section loads asynchronously, so its absence is only proven after a wait. */
async function expectNoSection() {
  await expect(screen.findByTestId("starred-dashboards", {}, { timeout: 300 })).rejects.toThrow(
    "Unable to find an element",
  );
}

describe("the Dashboards section analytics lends", () => {
  describe("given a member who can reach Dashboards, in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("draws analytics' section under the product's own pages", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(await screen.findByTestId("starred-dashboards")).toBeInTheDocument();
      expect(screen.getByText("Observe")).toBeInTheDocument();
    });
  });

  describe("given the same member, in Gateway, Governance or Me", () => {
    /** @scenario "Only the LLM Ops sidebar shows the Dashboards section" */
    it.each([
      { surface: "gateway", pathname: "/gateway/virtual-keys" },
      { surface: "governance", pathname: "/governance" },
      { surface: "me", pathname: "/coding-agents" },
    ] as const)("draws no section in $surface", async ({ surface, pathname }) => {
      renderSidebar({ surface, pathname, everyProductFlag: false });

      await expectNoSection();
    });
  });

  describe("given the same member, in Dashboards", () => {
    /** @scenario "Only the LLM Ops sidebar shows the Dashboards section" */
    it("leaves the boards to the saved-dashboards list", async () => {
      renderSidebar({
        surface: "dashboards",
        pathname: "/demo/dashboards",
        everyProductFlag: false,
      });

      expect(await screen.findByTestId("saved-dashboards")).toBeInTheDocument();
      await expectNoSection();
    });
  });

  describe("given a member who cannot reach Dashboards, in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("draws no section", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", permissions: [] });

      await expectNoSection();
    });
  });
});

describe("the Dashboards section with Dashboards in every product on", () => {
  /** Gateway stands on the remembered project; Coding agents on the member's own workspace. */
  const outsideLlmOps = [
    { surface: "gateway", pathname: "/gateway/virtual-keys", project: SHOP },
    { surface: "me", pathname: "/coding-agents", project: PERSONAL },
  ] as const;

  describe("given a member who can reach Dashboards, in Gateway or Coding agents", () => {
    /** @scenario "With no setting for the flag, Gateway and Coding agents show the Dashboards section" */
    it.each(outsideLlmOps)(
      "draws the section from the registry default, in $surface",
      async ({ surface, pathname, project }) => {
        // Nothing passes the flag, so the section shows only if the contract default is on.
        expect(EVERY_PRODUCT_DEFAULT, "the registry default must be on").toBe(true);
        renderSidebar({
          surface,
          pathname,
          project,
          openableTeams: [PERSONAL_TEAM, SHOP_TEAM],
          rememberedProjectSlug: "shop",
        });

        expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
          "Pinned dashboards in Shop (project-shop)",
        );
      },
    );
  });

  describe("given the same member, in Governance", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it("draws no section", async () => {
      renderSidebar({ surface: "governance", pathname: "/governance", everyProductFlag: true });

      await expectNoSection();
    });
  });

  describe("given a member who cannot reach Dashboards, in Gateway or Coding agents", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it.each(outsideLlmOps)("draws no section in $surface", async ({ surface, pathname }) => {
      renderSidebar({ surface, pathname, permissions: [], everyProductFlag: true });

      await expectNoSection();
    });
  });

  describe("given no project LLM Ops could open", () => {
    /** @scenario "Gateway and Coding agents show the Dashboards section of the project LLM Ops opens" */
    it("draws no section in Coding agents", async () => {
      renderSidebar({
        surface: "me",
        pathname: "/coding-agents",
        project: PERSONAL,
        everyProductFlag: true,
        openableTeams: [PERSONAL_TEAM],
      });

      await expectNoSection();
    });
  });

  describe("given Coding agents on the member's own workspace, with LLM Ops opening Shop", () => {
    const codingAgents = {
      surface: "me",
      pathname: "/coding-agents",
      project: PERSONAL,
      everyProductFlag: true,
      openableTeams: [PERSONAL_TEAM, SHOP_TEAM],
      rememberedProjectSlug: "shop",
    } as const;

    describe("when Dashboards is released for the workspace but not for Shop", () => {
      /** @scenario "In Gateway or Coding agents, the Dashboards section follows the named project's release flag" */
      it("draws no section, so no '+' makes a board Shop's Dashboards cannot open", async () => {
        renderSidebar({
          ...codingAgents,
          dashboardsFlag: true,
          dashboardsFlagByProject: { [PERSONAL.id]: true, [SHOP.id]: false },
        });

        await expectNoSection();
      });
    });

    describe("when Dashboards is released for Shop but not for the workspace", () => {
      /** @scenario "In Gateway or Coding agents, the Dashboards section follows the named project's release flag" */
      it("hands the section Shop", async () => {
        renderSidebar({
          ...codingAgents,
          dashboardsFlag: false,
          dashboardsFlagByProject: { [PERSONAL.id]: false, [SHOP.id]: true },
        });

        expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
          "Pinned dashboards in Shop (project-shop)",
        );
      });
    });

    describe("when the page's organization has not arrived", () => {
      /** @scenario "In Gateway or Coding agents, the Dashboards section follows the named project's release flag" */
      it("draws no section until the release flag can be asked", async () => {
        renderSidebar({
          ...codingAgents,
          organization: null,
          dashboardsFlagByProject: { [SHOP.id]: true },
        });

        await expectNoSection();
      });
    });

    describe("when this browser turned Dashboards on but Shop is not released", () => {
      /** @scenario "This browser's Dashboards override decides the named project's section" */
      it("hands the section Shop", async () => {
        applyFeatureFlagOverridesFromSearch("?ff_release_dashboards=on");
        renderSidebar({ ...codingAgents, dashboardsFlagByProject: { [SHOP.id]: false } });

        expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
          "Pinned dashboards in Shop (project-shop)",
        );
      });
    });

    describe("when this browser turned Dashboards off but Shop is released", () => {
      /** @scenario "This browser's Dashboards override decides the named project's section" */
      it("draws no section", async () => {
        applyFeatureFlagOverridesFromSearch("?ff_release_dashboards=off");
        renderSidebar({ ...codingAgents, dashboardsFlagByProject: { [SHOP.id]: true } });

        await expectNoSection();
      });
    });

    describe("when the member may view dashboards in the workspace but not in Shop", () => {
      /** @scenario "In Gateway or Coding agents, the Dashboards section follows the named project's view grant" */
      it("draws no section, so no '+' offers Dashboards Shop will not open", async () => {
        renderSidebar({
          ...codingAgents,
          permissions: ["analytics:view"],
          permissionsByProject: { [PERSONAL.id]: ["analytics:view"], [SHOP.id]: [] },
        });

        await expectNoSection();
      });
    });

    describe("when the member may view dashboards in Shop but not in the workspace", () => {
      /** @scenario "In Gateway or Coding agents, the Dashboards section follows the named project's view grant" */
      it("hands the section Shop", async () => {
        renderSidebar({
          ...codingAgents,
          permissions: [],
          permissionsByProject: { [SHOP.id]: ["analytics:view"] },
        });

        expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
          "Pinned dashboards in Shop (project-shop)",
        );
      });
    });
  });

  describe("given the same member, in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar's Dashboards section names no project" */
    it("hands the section no project, so it works in the one in scope", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", everyProductFlag: true });

      expect(await screen.findByTestId("starred-dashboards")).toHaveTextContent(
        /^Pinned dashboards$/,
      );
    });
  });
});
