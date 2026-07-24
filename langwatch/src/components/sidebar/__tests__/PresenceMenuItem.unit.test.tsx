/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem, Menu } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceMenuItem } from "../PresenceMenuItem";

const usePresenceFeatureEnabledMock = vi.hoisted(() => vi.fn());
const usePresencePreferencesStoreMock = vi.hoisted(() => vi.fn());

vi.mock("~/features/presence/hooks/usePresenceFeatureEnabled", () => ({
  usePresenceFeatureEnabled: usePresenceFeatureEnabledMock,
}));

vi.mock("~/features/presence/stores/presencePreferencesStore", () => ({
  usePresencePreferencesStore: usePresencePreferencesStoreMock,
}));

function renderInOpenMenu() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Menu.Root defaultOpen>
        <Menu.Trigger>open</Menu.Trigger>
        <Menu.Content>
          <PresenceMenuItem />
        </Menu.Content>
      </Menu.Root>
    </ChakraProvider>,
  );
}

describe("PresenceMenuItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the presence feature is enabled and the user is sharing presence", () => {
    describe("when the menu opens", () => {
      /** @scenario Avatar menu surfaces the presence toggle on the traces page */
      it("renders the Sharing presence label so the operator can see their current state", () => {
        usePresenceFeatureEnabledMock.mockReturnValue({
          enabled: true,
          disabledAt: null,
        });
        // Zustand selector — the component calls the store twice (hidden,
        // toggleHidden); the mock receives a selector each time.
        const toggleHidden = vi.fn();
        usePresencePreferencesStoreMock.mockImplementation(
          (selector: (s: { hidden: boolean; toggleHidden: () => void }) => unknown) =>
            selector({ hidden: false, toggleHidden }),
        );

        renderInOpenMenu();

        expect(screen.getAllByText("Sharing presence")[0]!).toBeInTheDocument();
      });
    });

  });

  describe("given the presence feature is disabled at the organization level", () => {
    describe("when the menu opens", () => {
      it("renders a disabled Presence off row that does not call toggleHidden on click", async () => {
        usePresenceFeatureEnabledMock.mockReturnValue({
          enabled: false,
          disabledAt: "organization",
        });
        const toggleHidden = vi.fn();
        usePresencePreferencesStoreMock.mockImplementation(
          (selector: (s: { hidden: boolean; toggleHidden: () => void }) => unknown) =>
            selector({ hidden: false, toggleHidden }),
        );

        renderInOpenMenu();

        const items = screen.getAllByRole("menuitem");
        const row = items.find((el) =>
          /Presence off/.test(el.textContent ?? ""),
        )!;
        expect(row.getAttribute("aria-disabled")).toBe("true");
        expect(toggleHidden).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the user has hidden their presence", () => {
    describe("when the menu opens", () => {
      it("renders a Presence hidden label so the operator sees the inverted state", () => {
        usePresenceFeatureEnabledMock.mockReturnValue({
          enabled: true,
          disabledAt: null,
        });
        const toggleHidden = vi.fn();
        usePresencePreferencesStoreMock.mockImplementation(
          (selector: (s: { hidden: boolean; toggleHidden: () => void }) => unknown) =>
            selector({ hidden: true, toggleHidden }),
        );

        renderInOpenMenu();

        expect(screen.getAllByText("Presence hidden").length).toBeGreaterThan(0);
      });
    });
  });

  // The placement contract lives in two consuming files — `MainMenu`
  // shouldn't render the sidebar toggle anymore, and `DashboardLayout`
  // gates the avatar-menu entry on the traces pathname. Source-level
  // assertions are durable across UI restyles where DOM-level queries
  // would drift.
  describe("given the main left navigation chrome", () => {
    /** @scenario Main left navigation no longer renders the presence toggle */
    it("does not import the legacy sidebar PresenceToggle component", () => {
      const src = readFileSync(
        resolve(__dirname, "../../MainMenu.tsx"),
        "utf8",
      );
      expect(src).not.toMatch(/PresenceToggle/);
    });
  });

  describe("given the avatar dropdown in DashboardLayout", () => {
    /** @scenario Avatar menu omits the presence toggle off the traces page */
    it("gates the PresenceMenuItem render on the /[project]/traces pathname", () => {
      const src = readFileSync(
        resolve(__dirname, "../../DashboardLayout.tsx"),
        "utf8",
      );
      // The gating expression is the source of truth: the menu item is
      // only rendered when this flag is true, so the route check
      // staying in place is what enforces the off-traces behavior.
      expect(src).toMatch(
        /showPresenceMenuItem\s*=\s*router\.pathname\.startsWith\("\/\[project\]\/traces"\)/,
      );
      expect(src).toMatch(/\{showPresenceMenuItem\s*&&\s*<PresenceMenuItem\s*\/>\}/);
    });
  });
});
