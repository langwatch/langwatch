/**
 * A user-supplied organization name never pushes the header around: it
 * truncates with an ellipsis, shows in full on hover and keeps the right-hand
 * controls on screen. Real layout, which jsdom cannot measure.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

vi.mock("../../../behavior/user/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    limits: { getUsage: { useQuery: () => ({}) } },
    user: {
      getSsoStatus: { useQuery: () => ({}) },
      whatsNew: { useQuery: () => ({}) },
      markWhatsNewSeen: { useMutation: () => ({ mutate: () => undefined }) },
    },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout.ts";
import { StubNavigationHost } from "../../../testing.tsx";
import { ShellTopBar } from "../shell-top-bar.tsx";

const LONG_NAME = "A".repeat(300);
const SHOTS = "/Users/lw/Source/github.com/langwatch/langwatch/.claude/tmp/long-names";
const LONG_ORG = { id: "org_long", name: LONG_NAME, teams: [] };
const OTHER_ORG = { id: "org_2", name: "ACME", teams: [] };
const USER = { id: "user_1", name: "Ada", email: "ada@acme.test", image: null };

afterEach(() => cleanup());

function renderBar({ organizations }: { organizations: (typeof LONG_ORG)[] }) {
  renderWithDesignSystem(
    <NavigationHostProvider
      value={StubNavigationHost.create({
        organization: LONG_ORG,
        organizations,
        currentUser: USER,
        commandBar: {
          shortcut: "K",
          open: () => undefined,
          trigger: <button type="button">Search</button>,
        },
      })}
    >
      <ShellTopBar
        state={{
          status: "ready",
          user: USER,
          project: undefined,
          currentRoute: undefined,
          activeProductId: null,
          isSettingsRoute: true,
          seatRefusal: null,
          showDevelopmentIndicator: false,
          isCompactSidebar: false,
          isMobile: false,
          menuWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
        }}
        shouldShowProductCluster
      />
    </NavigationHostProvider>,
  );
}

describe("the top bar with a 300-character organization name", () => {
  describe("when the reader belongs to several organizations", () => {
    it("truncates the picker clear of the Search button and names it on hover", async () => {
      await page.viewport(1280, 400);
      renderBar({ organizations: [LONG_ORG, OTHER_ORG] });

      const picker = screen.getByRole("button", { name: "Switch organization" });
      const search = screen.getByRole("button", { name: "Search" });

      expect(picker.getBoundingClientRect().right).toBeLessThanOrEqual(
        search.getBoundingClientRect().left,
      );
      expect(picker).toHaveAttribute("title", LONG_NAME);
      await page.screenshot({ path: `${SHOTS}/top-bar-multi-org.png` });
    });

    it("keeps the open switcher inside the viewport", async () => {
      await page.viewport(1280, 400);
      renderBar({ organizations: [LONG_ORG, OTHER_ORG] });

      await userEvent.click(screen.getByRole("button", { name: "Switch organization" }));
      const item = await screen.findByRole("menuitem", { name: new RegExp(LONG_NAME) });
      await waitFor(() => expect(item).toBeVisible());

      expect(item.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await page.screenshot({ path: `${SHOTS}/org-switcher-open.png` });
    });
  });

  describe("when the reader belongs to one organization", () => {
    it("truncates the plain name clear of the Search button", async () => {
      await page.viewport(1280, 400);
      renderBar({ organizations: [LONG_ORG] });

      const name = screen.getByText(LONG_NAME);
      const search = screen.getByRole("button", { name: "Search" });

      expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(
        search.getBoundingClientRect().left,
      );
      expect(name).toHaveAttribute("title", LONG_NAME);
      await page.screenshot({ path: `${SHOTS}/top-bar-single-org.png` });
    });
  });
});
