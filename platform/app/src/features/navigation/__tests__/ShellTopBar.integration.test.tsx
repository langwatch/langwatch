/**
 * @vitest-environment jsdom
 *
 * The top bar as a composition: which marks it carries at once. The
 * impersonation banner and the development badge are each proven on their
 * own elsewhere; this is the one place that shows neither hides the other.
 *
 * Corresponds to specs/auth/impersonation-banner.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShellTopBar } from "../shell/ShellTopBar";
import type { NavigationV2ShellReadyState } from "../shell/useNavigationV2ShellState";

// The controls beside the marks each pull in the session, the router and the
// API; none of them is what this file looks at.
vi.mock("../shell/OrganizationSelect", () => ({
  OrganizationSelect: () => null,
}));
vi.mock("../shell/ProductScopeControl", () => ({
  ProductScopeControl: () => null,
}));
vi.mock("../shell/ProductSwitcherMenu", () => ({
  ProductSwitcherMenu: () => null,
}));
vi.mock("~/components/AppHeaderUserMenu", () => ({
  AppHeaderUserMenu: () => null,
}));
vi.mock("~/features/command-bar", () => ({
  CommandBarTrigger: () => null,
}));

const admin = {
  id: "user_target",
  name: "Target User",
  email: "target@acme.test",
  impersonator: { id: "user_admin", name: "Admin", email: "admin@acme.test" },
};

function readyState(
  overrides: Partial<NavigationV2ShellReadyState>,
): NavigationV2ShellReadyState {
  return {
    status: "ready",
    user: admin,
    project: null,
    currentRoute: null,
    activeProductId: null,
    isSettingsRoute: false,
    isDevelopment: false,
    isCompactSidebar: false,
    isMobile: false,
    menuWidth: "240px",
    showPresenceMenuItem: false,
    langyDockInset: 0,
    ...overrides,
  } as NavigationV2ShellReadyState;
}

function renderTopBar(state: NavigationV2ShellReadyState) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ShellTopBar state={state} shouldShowProductCluster={false} />
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("the top bar's marks", () => {
  describe("when an admin impersonates somebody on a development build", () => {
    /** @scenario Banner coexists with dev mode indicator */
    it("shows the impersonation banner and the development badge together", () => {
      renderTopBar(readyState({ isDevelopment: true }));

      expect(screen.getByText("Impersonating Target User")).toBeInTheDocument();
      expect(screen.getByText("DEV")).toBeInTheDocument();
    });
  });

  describe("when nobody is impersonated on a development build", () => {
    it("shows only the development badge", () => {
      renderTopBar(
        readyState({
          isDevelopment: true,
          user: { id: "user_1", name: "Ada", email: "ada@acme.test" },
        }),
      );

      expect(screen.getByText("DEV")).toBeInTheDocument();
      expect(screen.queryByText(/impersonating/i)).not.toBeInTheDocument();
    });
  });
});
