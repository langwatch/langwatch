/**
 * specs/auth/impersonation-banner.feature: the header draws the banner the host hands it.
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
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

import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout.ts";
import { StubNavigationHost } from "../../../testing.tsx";
import { ShellTopBar } from "../shell-top-bar.tsx";

const ORGANIZATION = { id: "org_1", name: "ACME", teams: [] };
const USER = {
  id: "user_1",
  name: "Ada",
  email: "ada@acme.test",
  image: null,
  impersonator: { id: "admin_1", email: "admin@acme.test" },
};

afterEach(() => {
  cleanup();
});

describe("the shell top bar under an impersonation", () => {
  /** @scenario Banner coexists with dev mode indicator */
  it("draws the host's banner in the header alongside the development badge", () => {
    renderWithDesignSystem(
      <NavigationHostProvider
        value={StubNavigationHost.create({
          organization: ORGANIZATION,
          organizations: [ORGANIZATION],
          currentUser: USER,
          deployment: { isDevelopment: true, devIndicatorLabel: "Dev build" },
          accountMenu: { headerBanner: <span>Impersonating Ada</span> },
        })}
      >
        <ShellTopBar
          state={{
            status: "ready",
            user: USER,
            project: undefined,
            currentRoute: undefined,
            activeProductId: null,
            isSettingsRoute: false,
            seatRefusal: null,
            showDevelopmentIndicator: true,
            isCompactSidebar: false,
            isMobile: false,
            menuWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
          }}
          shouldShowProductCluster
        />
      </NavigationHostProvider>,
    );

    expect(screen.getByText("Impersonating Ada")).not.toBeNull();
    expect(screen.getAllByText("Dev build").length).toBeGreaterThan(0);
  });
});
