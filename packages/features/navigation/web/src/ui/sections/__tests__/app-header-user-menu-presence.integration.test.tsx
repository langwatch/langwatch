/**
 * @vitest-environment jsdom
 *
 * The presence toggle reaches the account dropdown as `accountMenu.presence`,
 * and the host offers it only on the surface that broadcasts presence. What is
 * asserted here is the menu's half of that: it draws the row the host offers,
 * and draws none when the host offers none.
 *
 * Spec: specs/traces-v2/presence-toggle-placement.feature
 */

import { ChakraProvider, defaultSystem, Menu } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({ data: { enabledByOrganizationId: {} } }),
      },
    },
  },
}));

import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing";
import { AppHeaderUserMenu } from "../app-header-user-menu";

const PRESENCE_ROW = (
  <Menu.Item value="presence" closeOnSelect={false}>
    Sharing presence
  </Menu.Item>
);

function renderMenu(readings: Partial<StubNavigationReadings>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          currentUser: { id: "user-1", name: "Ada", email: "ada@example.com", image: null },
          organization: { id: "org-1", name: "Acme", teams: [] },
          ...readings,
        }}
      >
        <AppHeaderUserMenu />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

async function openTheMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Open user menu/i }));
  await screen.findByText("Settings");
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the account dropdown's presence row", () => {
  describe("given the host offers a presence toggle", () => {
    describe("when the avatar menu is opened", () => {
      it("draws the row beside the account entries", async () => {
        renderMenu({ accountMenu: { presence: PRESENCE_ROW } });

        await openTheMenu();

        expect(screen.getByText("Sharing presence")).toBeTruthy();
      });
    });
  });

  describe("given the host offers no presence toggle", () => {
    describe("when the avatar menu is opened", () => {
      /** @scenario Avatar menu omits the presence toggle off the traces page */
      it("draws no presence row at all", async () => {
        renderMenu({ accountMenu: null });

        await openTheMenu();

        expect(screen.queryByText("Sharing presence")).toBeNull();
        expect(
          screen.getAllByRole("menuitem").some((item) => /presence/i.test(item.textContent ?? "")),
        ).toBe(false);
      });
    });
  });
});
