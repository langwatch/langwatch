/**
 * @vitest-environment jsdom
 *
 * Where the human-chat entry lives per chrome: standalone above the
 * Support menu in the current chrome, folded into the Support menu as
 * "Chat (with a human)" in the navigation-v2 sidebars.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true } }),
}));

const toggleSupportChatMock = vi.fn();
vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: () => toggleSupportChatMock(),
}));

import { SupportMenu } from "../SupportMenu";

function renderMenu(props: Record<string, unknown> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SupportMenu {...props} />
    </ChakraProvider>,
  );
}

async function openSupportMenu() {
  const user = userEvent.setup();
  // The Support menu opens on hover; a click would toggle the controlled
  // menu straight back closed.
  await user.hover(screen.getByRole("button", { name: "Support" }));
  await waitFor(() => {
    expect(screen.getByText("GitHub Support")).toBeVisible();
  });
  return user;
}

beforeEach(() => {
  toggleSupportChatMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the support menu chat placement", () => {
  describe("when rendered for the current chrome", () => {
    /** @scenario The current chrome keeps the standalone chat entry */
    it("keeps the standalone chat entry and no chat item in the menu", async () => {
      renderMenu();

      expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();

      await openSupportMenu();
      expect(screen.queryByText("Chat (with a human)")).not.toBeInTheDocument();
    });
  });

  describe("when rendered for a navigation-v2 sidebar", () => {
    /** @scenario Chat moves inside the Support menu in the new modes */
    it("folds the chat into the Support menu and drops the standalone entry", async () => {
      renderMenu({ chatPlacement: "in-menu" });

      expect(
        screen.queryByRole("button", { name: "Chat" }),
      ).not.toBeInTheDocument();

      const user = await openSupportMenu();
      const chatItem = screen.getByText("Chat (with a human)");
      expect(chatItem).toBeInTheDocument();

      await user.click(chatItem);
      expect(toggleSupportChatMock).toHaveBeenCalledTimes(1);
    });
  });
});
