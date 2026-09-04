/**
 * @vitest-environment jsdom
 *
 * The Settings sidebar in the navigation-v2 shell: the way back, the
 * regrouped iconed menu with its gates, the fold state, the rule under
 * the back entry, and the top bar's static Settings title.
 *
 * Lifted from
 * `platform/app/src/features/navigation/__tests__/SettingsShellV2.integration.test.tsx`
 * (deleted with `platform/app`). The legacy chrome's `SettingsLayout` and
 * `DashboardLayout` are `SidebarContent surface="settings"` and
 * `ShellTopBar` now; the mocks that named that application's hooks are the
 * stub navigation host.
 *
 * Specs: specs/navigation/settings-shell-v2.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let opsBadgeCounts: { data?: { blockedCount: number; dlqCount: number; computedAt: Date | null } } =
  {};

vi.mock("../../../behavior/navigation-api", () => ({
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

import { captureSettingsReturnPath } from "../../../model/resolve-settings-back-target";
import { WithStubNavigationHost, StubNavigationHost } from "../../../testing";
import { NavigationHostProvider } from "../../../model/navigation-host";
import { ShellTopBar } from "../shell-top-bar";
import type { NavigationShellReadyState } from "../../../behavior/use-navigation-shell-state";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout";
import { SidebarContent } from "../product-sidebar";

const ORGANIZATION = { id: "org_1", name: "ACME", teams: [] };
const commandBarOpenMock = vi.fn();

function renderSettingsSidebar({
  pathname = "/settings",
  isLiteMember = false,
  isEnterprise = true,
  hasOpsAccess = false,
  isOpsAdmin = false,
}: {
  pathname?: string;
  isLiteMember?: boolean;
  isEnterprise?: boolean;
  hasOpsAccess?: boolean;
  isOpsAdmin?: boolean;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          organization: ORGANIZATION,
          organizations: [ORGANIZATION],
          pathname,
          permissions: ["organization:view", "auditLog:view", "triggers:view"],
          plan: { isEnterprise, isLoading: false, isLiteMember },
          opsAccess: { hasAccess: hasOpsAccess, isAdmin: isOpsAdmin },
          commandBar: { shortcut: "⌘K", open: commandBarOpenMock, trigger: null },
        }}
      >
        <SidebarContent surface="settings" showExpanded />
      </WithStubNavigationHost>
    </ChakraProvider>,
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
    isDevelopment: false,
    isCompactSidebar: false,
    isMobile: false,
    menuWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
  };
}

function renderSettingsTopBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <NavigationHostProvider
        value={StubNavigationHost.create({
          organization: ORGANIZATION,
          organizations: [ORGANIZATION],
          currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
        })}
      >
        <ShellTopBar state={readySettingsShellState()} shouldShowProductCluster />
      </NavigationHostProvider>
    </ChakraProvider>,
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

describe("the settings shell in a new navigation mode", () => {
  describe("when Settings was entered from a Gateway page", () => {
    /** @scenario The Settings sidebar opens with the way back */
    it("opens with the back entry, then Quick Search", () => {
      captureSettingsReturnPath({
        organizationId: ORGANIZATION.id,
        pathname: "/gateway/budgets",
      });
      renderSettingsSidebar();

      const back = screen.getByRole("link", { name: "Back to Gateway" });
      expect(back).toHaveAttribute("href", "/gateway/budgets");
      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
    });
  });

  describe("when the settings menu renders in a v2 mode", () => {
    /** @scenario The settings menu is grouped with its gates kept */
    it("shows the groups with the current addresses", () => {
      renderSettingsSidebar();

      expect(screen.getByText("Organization")).toBeInTheDocument();
      expect(screen.getByText("Access")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/settings");
      expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
        "href",
        "/settings/members",
      );
    });

    /** @scenario "Enterprise entries carry a quiet grey pill" */
    it("marks the enterprise entries with a grey pill in a hairline border", () => {
      renderSettingsSidebar();

      expect(screen.getByRole("link", { name: "Groups" })).toBeInTheDocument();
      const pills = screen.getAllByText("ENT");
      expect(pills.length).toBeGreaterThanOrEqual(1);
      // The hairline border is pinned on the shared chip style itself:
      // model/__tests__/quiet-chip-style.unit.test.ts.
      expect(pills[0]).toHaveStyle({ color: "var(--chakra-colors-gray-400)" });
    });

    /** @scenario "The settings groups fold, and start open" */
    it("opens every group, folds one away, and keeps it folded next time", async () => {
      const user = userEvent.setup();
      const { unmount } = renderSettingsSidebar();

      // A folded group reads "Expand <name>", so none of them means all open.
      expect(screen.queryAllByRole("button", { name: /^Expand / })).toEqual([]);
      expect(screen.getAllByRole("button", { name: /^Collapse / }).length).toBeGreaterThan(1);
      expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Collapse Access" }));

      expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse Organization" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();

      unmount();
      renderSettingsSidebar();

      expect(screen.getByRole("button", { name: "Expand Access" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
    });

    /** @scenario "A rule separates the way back from the pages below it" */
    it("draws a rule under the way back entry", () => {
      captureSettingsReturnPath({ organizationId: ORGANIZATION.id, pathname: "/gateway/budgets" });
      renderSettingsSidebar();

      const backEntry = screen.getByRole("link", { name: /^Back/ });
      expect(backEntry.parentElement).toHaveStyle({ borderBottomWidth: "1px" });
    });

    /** @scenario "The way back stays in place while the menu scrolls" */
    it("keeps the way back out of the region the menu scrolls in", () => {
      captureSettingsReturnPath({ organizationId: ORGANIZATION.id, pathname: "/gateway/budgets" });
      renderSettingsSidebar();

      const scrollRegion = screen.getByTestId("sidebar-scroll-region");
      expect(scrollRegion).not.toContainElement(screen.getByRole("link", { name: /^Back/ }));
      expect(scrollRegion).toContainElement(screen.getByRole("link", { name: "Members" }));
    });

    /** @scenario "The pages are cut at the rule as they scroll under the way back" */
    it("starts the scrolling part at the rule and keeps the gap inside it", () => {
      captureSettingsReturnPath({ organizationId: ORGANIZATION.id, pathname: "/gateway/budgets" });
      renderSettingsSidebar();

      const backEntry = screen.getByRole("link", { name: /^Back/ });
      expect(getComputedStyle(backEntry.parentElement!).marginBottom).toBe("0");
      expect(getComputedStyle(screen.getByTestId("sidebar-scroll-region")).paddingTop).toBe(
        "var(--chakra-spacing-1\\.5)",
      );
    });

    /** @scenario "API Keys sits under General" */
    it("puts API Keys under General, above the ACCESS group", () => {
      renderSettingsSidebar();

      const entries = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim());

      expect(entries.filter((entry) => entry === "API Keys")).toHaveLength(1);
      expect(entries.indexOf("API Keys")).toBe(entries.indexOf("General") + 1);
      expect(entries.indexOf("API Keys")).toBeLessThan(entries.indexOf("Members"));
    });

    /** @scenario The menu marks the page that is open */
    it("marks the entry of the page on screen, and only that one", () => {
      renderSettingsSidebar({ pathname: "/settings/email-suppressions" });

      const marked = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.textContent?.trim());

      expect(marked).toEqual(["Email Suppressions"]);
    });

    /** @scenario A lite member sees no restricted settings entries */
    it("hides the restricted entries from a lite member", () => {
      renderSettingsSidebar({ isLiteMember: true });

      expect(screen.queryByRole("link", { name: "API Keys" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Secrets" })).not.toBeInTheDocument();
    });
  });

  describe("when the settings top bar renders", () => {
    /** @scenario The top bar shows a static Settings title */
    it("shows a static Settings title, no product dropdown, and the organization", () => {
      renderSettingsTopBar();

      expect(screen.queryByRole("button", { name: "Switch product" })).not.toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
    });
  });

  describe("when the reader has ops access and is an admin", () => {
    /** @scenario The settings menu holds the ops groups at the bottom */
    it("puts Ops and Backoffice last", () => {
      renderSettingsSidebar({ hasOpsAccess: true, isOpsAdmin: true });

      const groupLabels = screen
        .getAllByText(
          /^(Organization|Access|AI Infrastructure|Data Controls|Project|Ops|Backoffice)$/,
        )
        .map((node) => node.textContent);

      expect(groupLabels.slice(-2)).toEqual(["Ops", "Backoffice"]);
    });
  });

  describe("when the reader has ops access", () => {
    /** @scenario The settings menu holds the ops groups at the bottom */
    it("shows the Ops group away from an ops page", () => {
      renderSettingsSidebar({ hasOpsAccess: true });

      expect(screen.getByText("Ops")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "The Foundry" })).toBeInTheDocument();
    });
  });

  describe("when the reader has no ops access", () => {
    /** @scenario A reader without ops access sees no ops groups */
    it("shows neither the Ops group nor the Backoffice group", () => {
      renderSettingsSidebar();

      expect(screen.queryByText("Ops")).not.toBeInTheDocument();
      expect(screen.queryByText("Backoffice")).not.toBeInTheDocument();
    });
  });

  describe("when an ops page is opened in a new navigation mode", () => {
    /** @scenario An ops page renders inside the new settings shell */
    it("marks the matching entry active for an ops page", () => {
      renderSettingsSidebar({ hasOpsAccess: true, pathname: "/ops/migrations" });

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
      const migrations = screen.getByRole("link", { name: "Migrations" });
      expect(migrations).toHaveAttribute("aria-current", "page");
    });

    /** @scenario An ops page renders inside the new settings shell */
    it("marks the owning entry active on an address that redirects onto it", () => {
      renderSettingsSidebar({ hasOpsAccess: true, pathname: "/ops/scheduler" });

      expect(screen.getByRole("link", { name: "Event Sourcing" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  });
});
