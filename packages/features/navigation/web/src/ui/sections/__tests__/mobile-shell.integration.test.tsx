/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/mobile-chrome.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
    limits: { getUsage: { useQuery: () => ({}) } },
    user: { getSsoStatus: { useQuery: () => ({}) } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import type { NavigationShellReadyState } from "../../../behavior/use-navigation-shell-state";
import { NavigationHostProvider } from "../../../model/navigation-host";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout";
import { StubNavigationHost } from "../../../testing";
import { MobileShell } from "../mobile-shell";

const teamA = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  projects: [{ id: "project_1", slug: "demo", name: "Demo", isPersonal: false }],
};
const orgA = { id: "org_1", name: "ACME", teams: [teamA] };
const orgB = { id: "org_2", name: "Beta Corp", teams: [] };

function readyState(overrides: Partial<NavigationShellReadyState> = {}): NavigationShellReadyState {
  return {
    status: "ready",
    user: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
    project: teamA.projects[0],
    currentRoute: undefined,
    activeProductId: "llm-ops",
    isSettingsRoute: false,
    isDevelopment: false,
    isCompactSidebar: false,
    isMobile: true,
    menuWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
    ...overrides,
  };
}

function renderShell({
  organizations = [orgA],
  pathname = "/demo",
  state = {},
}: {
  organizations?: (typeof orgA)[];
  pathname?: string;
  state?: Partial<NavigationShellReadyState>;
} = {}) {
  const host = StubNavigationHost.create({
    organization: organizations[0],
    organizations,
    project: teamA.projects[0],
    pathname,
    permissions: ["triggers:view"],
    commandBar: { shortcut: "⌘K", open: () => undefined, trigger: null },
    currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
  });
  return render(
    <ChakraProvider value={defaultSystem}>
      <NavigationHostProvider value={host}>
        <MobileShell state={readyState(state)}>
          <div data-testid="page-body" />
        </MobileShell>
      </NavigationHostProvider>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("the mobile chrome", () => {
  describe("when an LLM Ops page renders at phone width", () => {
    /** @scenario The mobile top bar holds the scope and the menu button only */
    it("shows the logo, the product selector, the project selector and the menu button, with no sidebar", () => {
      renderShell();

      expect(screen.getByRole("button", { name: "Switch product" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Switch project" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeInTheDocument();
      expect(screen.queryByTestId("product-sidebar")).not.toBeInTheDocument();
      expect(screen.queryByTestId("shell-product-cluster")).not.toBeInTheDocument();
    });

    /** @scenario LLM Ops keeps the organization out of the mobile bar */
    it("keeps the organization control out of the bar and offers it in the overlay", async () => {
      renderShell({ organizations: [orgA, orgB] });

      expect(screen.queryByRole("button", { name: "Switch organization" })).not.toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Switch organization" })).toBeInTheDocument();
    });

    /** @scenario The menu button opens the navigation overlay */
    it("opens a full-screen overlay carrying the product's pages and the account controls", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      const overlay = within(screen.getByTestId("mobile-menu-overlay"));
      expect(overlay.getByLabelText("Quick Search")).toBeInTheDocument();
      expect(overlay.getByText("Trace Explorer")).toBeInTheDocument();
      expect(overlay.getByRole("button", { name: "Open user menu for Ada" })).toBeInTheDocument();
      expect(overlay.getByRole("button", { name: "Close navigation menu" })).toBeInTheDocument();
    });

    /** @scenario Navigating from the overlay closes it */
    it("closes the overlay when a page is opened from it", async () => {
      const user = userEvent.setup();
      const host = StubNavigationHost.create({
        organization: orgA,
        organizations: [orgA],
        project: teamA.projects[0],
        pathname: "/demo",
        permissions: ["triggers:view"],
        commandBar: { shortcut: "⌘K", open: () => undefined, trigger: null },
        currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
      });
      const view = render(
        <ChakraProvider value={defaultSystem}>
          <NavigationHostProvider value={host}>
            <MobileShell state={readyState()}>
              <div data-testid="page-body" />
            </MobileShell>
          </NavigationHostProvider>
        </ChakraProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      // Tap a real entry. jsdom cannot follow the anchor, so the route
      // change the tap causes is applied to the stub host by hand.
      const overlay = within(screen.getByTestId("mobile-menu-overlay"));
      const entry = overlay.getByRole("link", { name: /Analytics/ });
      expect(entry).toHaveAttribute("href", "/demo/analytics");
      entry.addEventListener("click", (event) => event.preventDefault());
      await user.click(entry);

      const movedHost = StubNavigationHost.create({
        organization: orgA,
        organizations: [orgA],
        project: teamA.projects[0],
        pathname: "/demo/analytics",
        permissions: ["triggers:view"],
        commandBar: { shortcut: "⌘K", open: () => undefined, trigger: null },
        currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
      });
      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <NavigationHostProvider value={movedHost}>
            <MobileShell state={readyState()}>
              <div data-testid="page-body" />
            </MobileShell>
          </NavigationHostProvider>
        </ChakraProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByTestId("mobile-menu-overlay")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });

    /** @scenario The close button dismisses the overlay without navigating */
    it("closes when the close button is tapped and stays on the page", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      expect(screen.getByRole("dialog", { name: "Navigation menu" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close navigation menu" })).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Close navigation menu" }));

      await waitFor(() => {
        expect(screen.queryByTestId("mobile-menu-overlay")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });

    /** @scenario The overlay keeps the keyboard inside it */
    it("marks the page behind it inert and wraps Tab inside itself", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      const overlay = screen.getByTestId("mobile-menu-overlay");
      expect(screen.getByTestId("page-body").closest("[inert]")).toBeInTheDocument();
      expect(overlay.closest("[inert]")).toBeNull();

      const focusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const last = focusable.at(-1);
      const first = focusable[0];
      expect(last).toBeDefined();
      last?.focus();

      await user.tab();
      expect(first).toHaveFocus();

      await user.tab({ shift: true });
      expect(last).toHaveFocus();
    });

    /** @scenario Escape closes only the menu on top */
    it("leaves Escape to the menu the overlay opened", async () => {
      const user = userEvent.setup();
      renderShell({ organizations: [orgA, orgB] });

      await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await waitFor(() => {
        expect(screen.getByText("Beta Corp")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByText("Beta Corp")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
    });

    /** @scenario Escape closes the overlay and returns focus to the menu button */
    it("closes on Escape and moves focus back to the menu button", async () => {
      const user = userEvent.setup();
      renderShell();

      const menuButton = screen.getByRole("button", { name: "Open navigation menu" });
      await user.click(menuButton);
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByTestId("mobile-menu-overlay")).not.toBeInTheDocument();
      });
      expect(menuButton).toHaveFocus();
    });
  });

  describe("when a Gateway page renders at phone width", () => {
    /** @scenario An organization product shows the organization in the mobile bar */
    it("shows the organization and no project selector", () => {
      renderShell({ pathname: "/gateway/virtual-keys", state: { activeProductId: "gateway" } });

      // A single organization reads as plain text, same as on desktop.
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
    });
  });
});
