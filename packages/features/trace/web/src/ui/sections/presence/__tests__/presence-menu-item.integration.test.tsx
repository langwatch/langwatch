/**
 * The presence toggle as the account dropdown draws it.
 *
 * Spec: specs/traces-v2/presence-toggle-placement.feature
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem, Menu } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePresencePreferencesStore } from "@langwatch/presence-web/surfaces/presence-state";

import { PresenceMenuItem, type PresenceMenuItemProps } from "../presence-menu-item";

function renderInOpenMenu(switches: PresenceMenuItemProps) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Menu.Root defaultOpen>
        <Menu.Trigger>open</Menu.Trigger>
        <Menu.Content>
          <PresenceMenuItem {...switches} />
        </Menu.Content>
      </Menu.Root>
    </ChakraProvider>,
  );
}

/** The row the reader would click, whatever label it currently carries. */
function presenceRow(): HTMLElement | undefined {
  return screen
    .getAllByRole("menuitem")
    .find((element) => /Presence|presence/.test(element.textContent ?? ""));
}

beforeEach(() => {
  usePresencePreferencesStore.getState().setHidden(false);
});

afterEach(() => {
  cleanup();
});

describe("the presence toggle in the account dropdown", () => {
  describe("given presence is enabled and the reader is sharing it", () => {
    describe("when the account menu opens", () => {
      /** @scenario Avatar menu surfaces the presence toggle on the traces page */
      it("renders the Sharing presence row and hides presence when it is clicked", () => {
        renderInOpenMenu({});

        expect(screen.getAllByText("Sharing presence").length).toBeGreaterThan(0);

        fireEvent.click(presenceRow()!);

        expect(usePresencePreferencesStore.getState().hidden).toBe(true);
      });
    });
  });

  describe("given presence is disabled at the organization level", () => {
    describe("when the account menu opens", () => {
      it("renders a Presence off row the reader cannot toggle", () => {
        renderInOpenMenu({ organizationPresenceEnabled: false });

        expect(presenceRow()?.getAttribute("aria-disabled")).toBe("true");
        expect(usePresencePreferencesStore.getState().hidden).toBe(false);
      });
    });
  });

  describe("given the reader has hidden their presence", () => {
    describe("when the account menu opens", () => {
      it("renders the Presence hidden row so the inverted state reads back", () => {
        usePresencePreferencesStore.getState().setHidden(true);

        renderInOpenMenu({});

        expect(screen.getAllByText("Presence hidden").length).toBeGreaterThan(0);
      });
    });
  });
});
