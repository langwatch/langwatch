/**
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let opsBadgeCounts: { data?: { blockedCount: number; dlqCount: number; computedAt: Date | null } } =
  {};

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    ops: { getBadgeCounts: { useQuery: () => opsBadgeCounts } },
    limits: { getUsage: { useQuery: () => ({}) } },
    user: { getSsoStatus: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import type { NavigationShellReadyState } from "../../../behavior/use-navigation-shell-state.ts";
import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import { captureSettingsReturnPath } from "../../../model/resolve-settings-back-target.ts";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout.ts";
import { WithStubNavigationHost, StubNavigationHost } from "../../../testing.tsx";
import { SidebarContent } from "../product-sidebar.tsx";
import { ShellTopBar } from "../shell-top-bar.tsx";

const ORGANIZATION = { id: "org_1", name: "ACME", teams: [] };
const commandBarOpenMock = vi.fn();

function renderSettingsSidebar({
  pathname = "/settings",
  isLiteMember = false,
  isEnterprise = true,
  hasOpsAccess = false,
  isOpsAdmin = false,
  isSaaS = false,
  hasCloudOps = false,
  permissions = ["organization:view", "auditLog:view", "triggers:view", "sso:view"],
  surface = "settings",
}: {
  surface?: "settings" | "admin";
  pathname?: string;
  isLiteMember?: boolean;
  isEnterprise?: boolean;
  hasOpsAccess?: boolean;
  isOpsAdmin?: boolean;
  isSaaS?: boolean;
  hasCloudOps?: boolean;
  permissions?: string[];
} = {}) {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        pathname,
        permissions,
        plan: { isEnterprise, isLoading: false, isLiteMember },
        opsAccess: { hasAccess: hasOpsAccess, isAdmin: isOpsAdmin },
        deployment: { isSaaS, hasCloudOps },
        commandBar: { shortcut: "⌘K", open: commandBarOpenMock, trigger: null },
      }}
    >
      <SidebarContent surface={surface} showExpanded />
    </WithStubNavigationHost>,
  );
}

function readySettingsShellState(): NavigationShellReadyState {
  return {
    status: "ready",
    user: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
    project: undefined,
    currentRoute: undefined,
    activeProductId: null,
    isSettingsRoute: true,
    seatRefusal: null,
    showDevelopmentIndicator: false,
    isCompactSidebar: false,
    isMobile: false,
    menuWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
  };
}

function renderSettingsTopBar() {
  return renderWithDesignSystem(
    <NavigationHostProvider
      value={StubNavigationHost.create({
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
      })}
    >
      <ShellTopBar state={readySettingsShellState()} shouldShowProductCluster />
    </NavigationHostProvider>,
  );
}

beforeEach(() => {
  opsBadgeCounts = {};
  commandBarOpenMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** Organization and Project each have a General entry, so the href picks the one meant. */
function generalLink(href: string) {
  return screen
    .getAllByRole("link", { name: "General" })
    .find((l) => l.getAttribute("href") === href);
}

describe("the settings shell in a new navigation mode", () => {
  describe("when Settings was entered from a Gateway page", () => {
    /** @scenario Settings keeps search first and Back immediately below it */
    it("puts Quick Search first and the back target directly below it", () => {
      captureSettingsReturnPath({
        organizationId: ORGANIZATION.id,
        pathname: "/gateway/budgets",
      });
      renderSettingsSidebar();

      expect(screen.getByTestId("sidebar-search-row").firstElementChild).toBe(
        screen.getByRole("button", { name: "Quick Search" }),
      );
      expect(screen.getByTestId("sidebar-search-row").nextElementSibling).toBe(
        screen.getByTestId("sidebar-back-row"),
      );
      const back = screen.getByRole("link", { name: "Back to Gateway" });
      expect(back).toHaveAttribute("href", "/gateway/budgets");
      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
    });
  });

  describe("when /ops is refused for lack of ops access", () => {
    it("offers no back entry to the last product visited", () => {
      captureSettingsReturnPath({
        organizationId: ORGANIZATION.id,
        pathname: "/gateway/budgets",
      });
      renderSettingsSidebar({ pathname: "/ops", hasOpsAccess: false });

      expect(screen.queryByRole("link", { name: /^Back/ })).not.toBeInTheDocument();
    });
  });

  describe("when the reader has no ops access", () => {
    /** @scenario "A reader without ops access sees no ops groups" */
    it("shows no Health, Tools, Instance or Cloud group", () => {
      renderSettingsSidebar({ hasOpsAccess: false });

      for (const label of ["Health", "Tools", "Instance", "Cloud"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    });
  });

  describe("when the settings menu renders in a v2 mode", () => {
    /** @scenario The settings menu is grouped with its gates kept */
    it("shows the groups with the current addresses", () => {
      renderSettingsSidebar();

      expect(screen.getByText("Organization")).toBeInTheDocument();
      expect(screen.getByText("People & access")).toBeInTheDocument();
      expect(generalLink("/settings")).toHaveAttribute("href", "/settings");
      expect(generalLink("/settings/project")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
        "href",
        "/settings/directory",
      );
    });

    /** @scenario The You section comes first and is about the reader */
    it("puts the reader's Profile and Security pages first", () => {
      renderSettingsSidebar();

      const links = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim());
      const groupButtons = screen
        .getAllByRole("button", { name: /^Collapse / })
        .map((button) => button.textContent?.trim());

      expect(groupButtons[0]).toBe("You");
      expect(links.slice(0, 2)).toEqual(["Profile", "Security"]);
      expect(groupButtons.indexOf("You")).toBeLessThan(groupButtons.indexOf("Organization"));
    });

    /** @scenario The personal pages ask for no organization permission */
    it("keeps Profile and Security when every organization permission is denied", () => {
      renderSettingsSidebar({ permissions: [] });

      expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
        "href",
        "/settings/profile",
      );
      expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
        "href",
        "/settings/security",
      );
    });

    it("keeps Authentication as one Organization entry, lit on its provider page", () => {
      renderSettingsSidebar({ pathname: "/settings/authentication/provider" });

      const organizationGroup = screen.getByRole("button", {
        name: "Collapse Organization",
      }).parentElement;
      const authentication = within(organizationGroup!).getByRole("link", {
        name: /^Authentication/,
      });
      expect(authentication).toHaveAttribute("href", "/settings/authentication");
      expect(authentication).toHaveAttribute("aria-current", "page");
      expect(screen.queryByRole("link", { name: "Identity Provider" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Connectors" })).not.toBeInTheDocument();
    });

    /** @scenario The access group is named for people and holds the organization's pages */
    it("keeps authentication with the organization and consolidates people access", () => {
      renderSettingsSidebar();

      const organizationGroup = screen.getByRole("button", {
        name: "Collapse Organization",
      }).parentElement;
      const peopleGroup = screen.getByRole("button", {
        name: "Collapse People & access",
      }).parentElement;

      expect(
        within(organizationGroup!).getByRole("link", { name: /^Authentication/ }),
      ).toHaveAttribute("href", "/settings/authentication");
      expect(within(peopleGroup!).getByRole("link", { name: "Directory" })).toHaveAttribute(
        "href",
        "/settings/directory",
      );
      expect(within(peopleGroup!).getByRole("link", { name: /^Roles/ })).toHaveAttribute(
        "href",
        "/settings/roles",
      );
      for (const name of ["Members", "Groups", "Access", "Role Bindings"]) {
        expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      }
    });

    it("lights Directory and Roles on the old addresses that forward onto them", () => {
      renderSettingsSidebar({ pathname: "/settings/members" });
      expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      cleanup();

      renderSettingsSidebar({ pathname: "/settings/role-bindings" });
      expect(screen.getByRole("link", { name: /^Roles/ })).toHaveAttribute("aria-current", "page");
    });

    /** @scenario "A plan with Enterprise sees its entries marked ENT, not locked" */
    it("marks the enterprise entries ENT on a plan that includes them", () => {
      renderSettingsSidebar();

      const roles = screen.getByRole("link", { name: /^Roles/ });
      expect(within(roles).getByText("ENT")).toBeInTheDocument();
      expect(screen.queryByLabelText("Included in Enterprise")).not.toBeInTheDocument();
    });

    /** @scenario "A plan without Enterprise sees its entries locked" */
    /** @scenario "Authentication is offered unlocked on every plan" */
    it("shows the enterprise entries with a lock on a plan that lacks them", () => {
      renderSettingsSidebar({ isEnterprise: false });

      for (const name of [/^Roles/, /^Audit log/]) {
        const link = screen.getByRole("link", { name });
        expect(within(link).getByLabelText("Included in Enterprise")).toBeInTheDocument();
      }
      expect(screen.queryByText("ENT")).not.toBeInTheDocument();
      for (const name of [/^Directory/, /^Authentication/]) {
        const link = screen.getByRole("link", { name });
        expect(within(link).queryByLabelText("Included in Enterprise")).not.toBeInTheDocument();
      }
    });

    /** @scenario "A plan without Enterprise sees its entries locked" */
    it("still hides a locked entry from a reader without its permission", () => {
      renderSettingsSidebar({ isEnterprise: false, permissions: ["organization:view"] });

      expect(screen.queryByRole("link", { name: /^Audit log/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Authentication/ })).not.toBeInTheDocument();
    });

    /** @scenario "Settings groups read in sentence case" */
    it("labels its groups in sentence case", () => {
      renderSettingsSidebar();

      expect(screen.getByText("AI infrastructure")).toHaveStyle({ fontSize: "12px" });
      expect(screen.getByText("Data controls")).not.toHaveStyle({ textTransform: "uppercase" });
    });

    /** @scenario "A detail page keeps its owning entry lit" */
    it("lights Directory on a team's own page", () => {
      renderSettingsSidebar({ pathname: "/settings/teams/platform" });
      expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    /** @scenario "The settings groups fold, and start open" */
    it("opens every group, folds one away, and keeps it folded next time", async () => {
      const user = userEvent.setup();
      const { unmount } = renderSettingsSidebar();

      // A folded group reads "Expand <name>", so none of them means all open.
      expect(screen.queryAllByRole("button", { name: /^Expand / })).toEqual([]);
      expect(screen.getAllByRole("button", { name: /^Collapse / }).length).toBeGreaterThan(1);
      expect(screen.getByRole("link", { name: "Directory" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Collapse People & access" }));

      expect(screen.queryByRole("link", { name: "Directory" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse Organization" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(generalLink("/settings")).toBeInTheDocument();

      unmount();
      renderSettingsSidebar();

      expect(screen.getByRole("button", { name: "Expand People & access" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.queryByRole("link", { name: "Directory" })).not.toBeInTheDocument();
      expect(generalLink("/settings")).toBeInTheDocument();
    });

    /** @scenario Quick Search stays above the menu without a divider */
    it("pins search outside the scrolling menu and draws no separator below it", () => {
      renderSettingsSidebar();
      const search = screen.getByRole("button", { name: "Quick Search" });
      const row = screen.getByTestId("sidebar-search-row");
      const region = screen.getByTestId("sidebar-scroll-region");
      expect(row).toContainElement(search);
      expect(region).not.toContainElement(search);
      expect(region).toContainElement(screen.getByRole("link", { name: "Directory" }));
      expect(getComputedStyle(row).borderBottomWidth).not.toBe("1px");
      const back = screen.getByRole("link", { name: /^Back/ });
      expect(region).not.toContainElement(back);
      expect(getComputedStyle(screen.getByTestId("sidebar-back-row")).borderBottomWidth).not.toBe(
        "1px",
      );
    });

    /** @scenario "API keys sits under General" */
    it("puts API keys under General, above the access group", () => {
      renderSettingsSidebar();

      const entries = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim());

      expect(entries.filter((entry) => entry === "API keys")).toHaveLength(1);
      expect(entries.indexOf("API keys")).toBe(entries.indexOf("General") + 1);
      expect(entries.indexOf("API keys")).toBeLessThan(entries.indexOf("Directory"));
    });

    /** @scenario The menu marks the page that is open */
    it("marks the entry of the page on screen, and only that one", () => {
      renderSettingsSidebar({ pathname: "/settings/email-suppressions" });

      const marked = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.textContent?.trim());

      expect(marked).toEqual(["Email suppressions"]);
    });

    /** @scenario A lite member sees no restricted settings entries */
    it("hides the restricted entries from a lite member", () => {
      renderSettingsSidebar({ isLiteMember: true });

      expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Secrets" })).not.toBeInTheDocument();
    });
  });

  describe("when the settings top bar renders", () => {
    /** @scenario The top bar keeps a static Settings label */
    it("shows the static Settings label, no product dropdown, and the organization", () => {
      renderSettingsTopBar();

      expect(screen.queryByRole("button", { name: "Switch product" })).not.toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
    });
  });

  describe("when the reader has ops access and is an admin", () => {
    /** @scenario "Settings holds no operator groups" */
    it("keeps Health, Tools, Instance and Cloud out of Settings", () => {
      renderSettingsSidebar({ hasOpsAccess: true, isOpsAdmin: true, hasCloudOps: true });

      for (const label of ["Health", "Tools", "Instance", "Cloud", "Ops"]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      expect(screen.queryByRole("link", { name: "Foundry" })).not.toBeInTheDocument();
    });

    /** @scenario "Settings points operators to the Operations console" */
    it("pins an Ops have moved link to the Operations console", () => {
      renderSettingsSidebar({ hasOpsAccess: true });

      expect(screen.getByRole("link", { name: "Ops have moved" })).toHaveAttribute("href", "/ops");
    });

    /** @scenario "Settings shows no signpost to a reader without ops access" */
    it("offers no Ops have moved link without ops access", () => {
      renderSettingsSidebar({ hasOpsAccess: false });

      expect(screen.queryByRole("link", { name: "Ops have moved" })).not.toBeInTheDocument();
    });

    /** @scenario "The Admin console has its own sidebar" */
    it("groups the Admin sidebar as Health, Tools, Instance and Cloud", () => {
      renderSettingsSidebar({
        surface: "admin",
        pathname: "/ops",
        hasOpsAccess: true,
        isOpsAdmin: true,
        hasCloudOps: true,
      });

      const groupLabels = screen
        .getAllByText(/^(Health|Tools|Instance|Cloud)$/)
        .map((node) => node.textContent);
      expect(groupLabels).toEqual(["Health", "Tools", "Instance", "Cloud"]);
      expect(screen.getByRole("link", { name: "Foundry" })).toBeInTheDocument();
    });

    it("hides Cloud without cloud ops", () => {
      renderSettingsSidebar({ surface: "admin", hasOpsAccess: true, isOpsAdmin: true });

      expect(screen.getByText("Instance")).toBeInTheDocument();
      expect(screen.queryByText("Cloud")).not.toBeInTheDocument();
    });
  });

  describe("when the reader has ops access but is no platform administrator", () => {
    it("offers Health and Tools only", () => {
      renderSettingsSidebar({ surface: "admin", hasOpsAccess: true });

      expect(screen.getByText("Health")).toBeInTheDocument();
      expect(screen.queryByText("Instance")).not.toBeInTheDocument();
    });
  });

  describe("when an ops page is opened in a new navigation mode", () => {
    /** @scenario An ops page renders inside the Admin console */
    it("marks the matching entry active for an ops page", () => {
      renderSettingsSidebar({ surface: "admin", hasOpsAccess: true, pathname: "/ops/upgrades" });

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
      const upgrades = screen.getByRole("link", { name: "Upgrades" });
      expect(upgrades).toHaveAttribute("aria-current", "page");
    });

    /** @scenario An ops page renders inside the Admin console */
    it("marks the owning entry active on an address that redirects onto it", () => {
      renderSettingsSidebar({ surface: "admin", hasOpsAccess: true, pathname: "/ops/scheduler" });

      expect(screen.getByRole("link", { name: "Event sourcing" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
});
