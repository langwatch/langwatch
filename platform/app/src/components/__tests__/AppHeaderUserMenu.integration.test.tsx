/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]/traces" }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    },
    status: "authenticated",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: false }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    },
    status: "authenticated",
  }),
}));

vi.mock("~/components/sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

vi.mock("../../../ee/admin/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));

vi.mock("~/utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

import { AppHeaderUserMenu } from "../AppHeaderUserMenu";

const renderMenu = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AppHeaderUserMenu />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("AppHeaderUserMenu", () => {
  describe("when the reader opens the navigation-mode picker", () => {
    /** @scenario The avatar menu offers the two navigation modes */
    it("shows the current mode and offers Product switcher and Icon rail", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));
      const trigger = await screen.findByText(/^Navigation \(/);
      expect(trigger.textContent).toContain("Product switcher");

      await user.hover(trigger);
      const submenu = await screen.findAllByRole("menuitemradio");
      const labels = submenu.map((item) => item.textContent);
      expect(labels).toEqual(
        expect.arrayContaining(["Product switcher", "Icon rail"]),
      );
    });
  });
});
