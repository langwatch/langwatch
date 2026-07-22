/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/account-menu-hub.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSetTheme = vi.fn();
let mockTheme = "system";
let mockIsLiteMember = false;
let mockIsSaas = true;

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: { id: "user_1", name: "Jane Doe", email: "jane@acme.com" },
    },
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: mockIsLiteMember }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1" },
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: mockIsSaas } }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true }),
  CLIENT_FLAG_STALE_TIME_MS: 60_000,
}));

vi.mock("../../../ee/admin/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));

vi.mock("../sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

import { AccountMenu } from "../AccountMenu";

const renderMenu = (
  props: Partial<React.ComponentProps<typeof AccountMenu>> = {},
) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AccountMenu {...props} />
    </ChakraProvider>,
  );

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Account" }));
};

describe("AccountMenu", () => {
  afterEach(() => {
    cleanup();
    mockSetTheme.mockClear();
    mockTheme = "system";
    mockIsLiteMember = false;
    mockIsSaas = true;
  });

  describe("when the user opens the avatar menu", () => {
    /** @scenario The avatar menu identifies the account */
    it("shows the user's name and email at the top", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    });

    /** @scenario Account destinations are grouped first */
    it("lists My Workspace, API Keys, and Settings", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(await screen.findByText("My Workspace")).toBeInTheDocument();
      expect(screen.getByText("API Keys")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    /** @scenario Log out is the last entry */
    it("offers Log out", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      const logout = await screen.findByText("Log out");
      expect(logout.closest("a")).toHaveAttribute(
        "href",
        "/api/auth/logout",
      );
    });

    /** @scenario Support lives in the avatar menu */
    it("offers the support submenu entries", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);
      await user.click(await screen.findByText("Support"));

      expect(await screen.findByText("Discord")).toBeInTheDocument();
      expect(screen.getByText("GitHub Support")).toBeInTheDocument();
      expect(screen.getByText("Status Page")).toBeInTheDocument();
      expect(screen.getByText("Feature Request")).toBeInTheDocument();
      expect(screen.getByText("Report a Bug")).toBeInTheDocument();
    });
  });

  describe("when the user picks a theme", () => {
    /** @scenario Theme is switched from the avatar menu */
    it("applies the theme without closing the menu", async () => {
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);
      await user.click(
        await screen.findByRole("radio", { name: "Set theme to Dark" }),
      );

      expect(mockSetTheme).toHaveBeenCalledWith("dark");
      // The menu stays open — the account header is still visible.
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });
  });

  describe("when the member is a lite member", () => {
    it("hides the API Keys entry", async () => {
      mockIsLiteMember = true;
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(await screen.findByText("Settings")).toBeInTheDocument();
      expect(screen.queryByText("API Keys")).not.toBeInTheDocument();
    });
  });

  describe("when the deployment is self-hosted", () => {
    /** @scenario Chat is offered on the hosted product only */
    it("renders no chat entry", async () => {
      mockIsSaas = false;
      const user = userEvent.setup();
      renderMenu();

      await openMenu(user);

      expect(await screen.findByText("Settings")).toBeInTheDocument();
      expect(screen.queryByText("Chat with us")).not.toBeInTheDocument();
    });
  });
});
