import { defineSlice } from "@langwatch/browser-host/global-store";
/**
 * @vitest-environment jsdom
 * The presence toggle as the account dropdown draws it.
 * Spec: specs/traces-v2/presence-toggle-placement.feature
 */
import { Menu } from "@langwatch/design-system/menu";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  PRESENCE_PREFERENCES_ABSENT,
  PRESENCE_PREFERENCES_SLICE,
  type PresencePreferencesState,
} from "@langwatch/presence-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PresenceMenuItem, type PresenceMenuItemProps } from "../presence-menu-item.tsx";

function renderInOpenMenu(switches: PresenceMenuItemProps) {
  return renderWithDesignSystem(
    <Menu.Root defaultOpen>
      <Menu.Trigger>open</Menu.Trigger>
      <Menu.Content>
        <PresenceMenuItem {...switches} />
      </Menu.Content>
    </Menu.Root>,
  );
}

/** The row the reader would click, whatever label it currently carries. */
function presenceRow(): HTMLElement | undefined {
  return screen
    .getAllByRole("menuitem")
    .find((element) => /Presence|presence/.test(element.textContent ?? ""));
}

// Stands in for presence, the owner of the slice, which this package only reads.
const usePresencePreferencesStore = defineSlice<PresencePreferencesState>({
  name: PRESENCE_PREFERENCES_SLICE,
  create: (set, get) => ({
    ...PRESENCE_PREFERENCES_ABSENT,
    setHidden: (hidden) => set({ hidden }),
    toggleHidden: () => set({ hidden: !get().hidden }),
  }),
});

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
