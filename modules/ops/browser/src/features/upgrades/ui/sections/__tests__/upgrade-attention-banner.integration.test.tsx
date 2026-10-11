/**
 * @vitest-environment jsdom
 * The shell's upgrade notice: members are told to contact their operator, operators get a link.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UPGRADES_PATH, UpgradeAttentionBanner } from "../upgrade-attention-banner.tsx";

const { notice, permissions } = vi.hoisted(() => ({
  notice: { show: false },
  permissions: new Set<string>(),
}));
vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiHostServices: () => ({
    session: { hasPermission: (permission: string) => permissions.has(permission) },
  }),
}));
vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../behavior/use-upgrade-attention-notice.ts", () => ({
  useUpgradeAttentionNotice: () => notice.show,
}));

const NOTICE = "LangWatch's last update needs attention. Contact your LangWatch operator.";

function renderBanner() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeAttentionBanner />
    </DesignSystemProvider>,
  );
}

describe("the shell's upgrade attention banner", () => {
  beforeEach(() => {
    notice.show = false;
    permissions.clear();
  });

  afterEach(cleanup);

  describe("given the notice answers show and a member without ops:view", () => {
    /** @scenario "The shell's upgrade notice tells a member to contact their operator" */
    it("tells them to contact their operator and offers no link", () => {
      notice.show = true;
      renderBanner();

      expect(screen.getByText(NOTICE)).not.toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("given the notice answers show and an operator holding ops:view", () => {
    /** @scenario "An operator's upgrade notice links to Ops › Upgrades" */
    it("links to Ops › Upgrades", () => {
      notice.show = true;
      permissions.add("ops:view");
      renderBanner();

      expect(screen.getByText(NOTICE)).not.toBeNull();
      expect(screen.getByRole("link").getAttribute("href")).toBe(UPGRADES_PATH);
    });
  });

  describe("given the notice has not answered yet", () => {
    /** @scenario "The upgrade notice shows nothing while it loads" */
    it("draws nothing", () => {
      renderBanner();

      expect(screen.queryByTestId("upgrade-attention-banner")).toBeNull();
    });
  });
});
