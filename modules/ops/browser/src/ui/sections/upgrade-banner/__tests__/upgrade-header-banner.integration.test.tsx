/**
 * The operator upgrade banner ops lends to the header.
 * Spec: modules/ops/specs/upgrade-alerts.feature
 * @vitest-environment jsdom
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UPGRADES_PATH, UpgradeHeaderBanner } from "../upgrade-header-banner.tsx";

const { navigate, statusRead, grants } = vi.hoisted(() => ({
  navigate: vi.fn(),
  statusRead: vi.fn(),
  grants: new Set<string>(),
}));
vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiHostServices: () => ({
    session: { hasPermission: (grant: string) => grants.has(grant) },
    navigation: { navigate },
  }),
}));
vi.mock("../../../../behavior/ops-api.ts", () => ({
  api: { ops: { upgrade: { status: { useQuery: statusRead } } } },
}));

function status(state: string, label: string) {
  return { isLoading: false, data: { state, label, tone: "warning" } };
}

function renderBanner() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeHeaderBanner />
    </DesignSystemProvider>,
  );
}

describe("the header's operator upgrade banner", () => {
  beforeEach(() => {
    navigate.mockReset();
    statusRead.mockReset();
    grants.clear();
    grants.add("ops:view");
  });

  afterEach(cleanup);

  /** @scenario The banner shows while the installation needs an operator */
  it.each([
    ["behind", "Behind"],
    ["unsupported", "Unsupported"],
    ["needs-attention", "Needs attention"],
  ])("names the %s state and links to the Upgrades page", (state, label) => {
    statusRead.mockReturnValue(status(state, label));
    renderBanner();
    expect(screen.getByText(`Upgrade: ${label}`)).not.toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Open Upgrades" }));
    expect(navigate).toHaveBeenCalledWith(UPGRADES_PATH);
  });

  /** @scenario The banner stays hidden while the installation is up to date */
  it("draws nothing while the installation is up to date", () => {
    statusRead.mockReturnValue(status("up-to-date", "Up to date"));
    renderBanner();
    expect(screen.queryByText(/Upgrade:/)).toBeNull();
  });

  it("shows a skeleton, not a state, while the status loads", () => {
    statusRead.mockReturnValue({ isLoading: true, data: void 0 });
    renderBanner();
    expect(screen.getByTestId("upgrade-banner-loading")).not.toBeNull();
    expect(screen.queryByText(/Upgrade:/)).toBeNull();
  });

  it("draws nothing and reads nothing for a reader without the operator grant", () => {
    grants.clear();
    renderBanner();
    expect(statusRead).not.toHaveBeenCalled();
    expect(screen.queryByText(/Upgrade:/)).toBeNull();
  });
});
