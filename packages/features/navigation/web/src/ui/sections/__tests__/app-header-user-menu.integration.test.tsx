/**
 * @vitest-environment jsdom
 *
 * The avatar menu's navigation-mode picker.
 *
 * MOVED from `platform/app`. The seven mocks that named that application's
 * hooks are the stub host now; the picker itself no longer sits behind a flag,
 * so what this asserts is that it is there and offers exactly the two shells.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { WithStubNavigationHost } from "../../../testing";
import { AppHeaderUserMenu } from "../app-header-user-menu";

const renderMenu = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          currentUser: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
          organization: { id: "org-1", name: "Acme", teams: [] },
        }}
      >
        <AppHeaderUserMenu />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("given a reader who never picked a navigation mode", () => {
  describe("when the avatar menu is opened", () => {
    /** @scenario The avatar menu offers the two navigation modes */
    it("shows the default mode and offers Product switcher and Icon rail", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.click(screen.getByRole("button", { name: /Open user menu/i }));
      const trigger = await screen.findByText(/^Navigation \(/);
      expect(trigger.textContent).toContain("Product switcher");

      await user.hover(trigger);
      const submenu = await screen.findAllByRole("menuitemradio");
      const labels = submenu.map((item) => item.textContent);
      expect(labels).toEqual(expect.arrayContaining(["Product switcher", "Icon rail"]));
    });
  });
});
