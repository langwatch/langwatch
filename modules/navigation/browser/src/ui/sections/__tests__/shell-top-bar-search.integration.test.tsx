/**
 * modules/navigation/specs/product-sidebars.feature: the top bar's Search pill opens the
 * command bar.
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
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

import { registerCommandBarControl } from "../../../features/command-bar/behavior/command-bar-control.ts";
import { CommandBarTrigger } from "../../../features/command-bar/ui/sections/command-bar-trigger.tsx";
import { NavigationHostProvider } from "../../../model/navigation-host.ts";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout.ts";
import { StubNavigationHost } from "../../../testing.tsx";
import { ShellTopBar } from "../shell-top-bar.tsx";

const ORGANIZATION = { id: "org_1", name: "ACME", teams: [] };
const USER = { id: "user_1", name: "Ada", email: "ada@acme.test", image: null };
const PROJECT = { id: "project_1", name: "Beacon", slug: "beacon" };

afterEach(() => {
  cleanup();
});

function renderTopBar({ project }: { project: typeof PROJECT | undefined }) {
  renderWithDesignSystem(
    <NavigationHostProvider
      value={StubNavigationHost.create({
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        currentUser: USER,
        commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: <CommandBarTrigger /> },
      })}
    >
      <ShellTopBar
        state={{
          status: "ready",
          user: USER,
          project,
          currentRoute: undefined,
          activeProductId: null,
          isSettingsRoute: false,
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

describe("the shell top bar's Search pill", () => {
  /** @scenario The top bar's Search pill opens the command bar */
  it("opens the command bar on a project page", () => {
    const open = vi.fn();
    const withdraw = registerCommandBarControl({ open, close: vi.fn(), toggle: vi.fn() });
    renderTopBar({ project: PROJECT });

    fireEvent.click(screen.getByRole("button", { name: "Open command bar" }));

    expect(open).toHaveBeenCalledOnce();
    withdraw();
  });

  it("is not drawn without a project in scope", () => {
    renderTopBar({ project: undefined });

    expect(screen.queryByRole("button", { name: "Open command bar" })).toBeNull();
  });
});
