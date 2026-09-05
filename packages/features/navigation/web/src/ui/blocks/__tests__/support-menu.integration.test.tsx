/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WithStubNavigationHost } from "../../../testing";
import { SupportMenu } from "../support-menu";

function renderMenu({ withChat = true }: { withChat?: boolean } = {}) {
  const openSupportChat = vi.fn();
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          supportChat: withChat ? { open: openSupportChat } : null,
        }}
      >
        <SupportMenu />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
  return { ...view, openSupportChat };
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

afterEach(() => {
  cleanup();
});

describe("the support menu chat placement", () => {
  describe("when the pointer opens the menu and moves away", () => {
    /** @scenario Closing the Support menu with the pointer leaves no focus ring */
    it("closes the menu without leaving focus on the Support entry", async () => {
      renderMenu();
      const trigger = screen.getByRole("button", { name: "Support" });

      const user = await openSupportMenu();
      await user.unhover(trigger);

      await waitFor(() => {
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      });
      // The machine focuses the trigger in a microtask after the close;
      // give that focus time to land before asserting it was dropped.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(trigger).not.toHaveFocus();
    });

    /** @scenario Closing the Support menu with the pointer leaves no focus ring */
    it("keeps focus on the Support entry after a keyboard close", async () => {
      renderMenu();
      const trigger = screen.getByRole("button", { name: "Support" });
      const user = userEvent.setup();

      trigger.focus();
      await user.keyboard("{Enter}");
      // The machine moves focus into the menu a frame after it opens;
      // Escape only closes the menu once it carries the focus.
      await waitFor(() => {
        expect(screen.getByRole("menu")).toHaveFocus();
      });

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      });
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });
  });

  describe("chat entry placement", () => {
    /** @scenario Chat moves inside the Support menu */
    it("folds the chat into the Support menu, no standalone entry", async () => {
      const { openSupportChat } = renderMenu();

      expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument();

      const user = await openSupportMenu();
      const chatItem = screen.getByText("Chat (with a human)");
      expect(chatItem).toBeInTheDocument();

      await user.click(chatItem);
      expect(openSupportChat).toHaveBeenCalledTimes(1);
    });
  });
});
