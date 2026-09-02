/**
 * @vitest-environment jsdom
 *
 * The navigation-mode resolution contract: a picked legacy resolves
 * synchronously with no flag check, a picked v2 mode waits for the flag
 * instead of flashing the old chrome, a device that picked nothing
 * follows the flag without ever waiting, and flag off falls back to
 * legacy without erasing the device preference.
 *
 * MOVED from `platform/app`. The two mocks that named that application's hooks
 * are the stub host now, and "the flag query never ran" is asserted where the
 * cost now lives: the ask on the host.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationHostProvider } from "../../model/navigation-host";
import { StubNavigationHost } from "../../testing";
import { loadStoredNavigationMode, useNavigationModeStore } from "../navigation-mode.store";
import { useNavigationMode } from "../use-navigation-mode";

const NAVIGATION_FLAG = "release_ui_navigation_v2_enabled";

type FlagAnswer = { enabled: boolean; isLoading: boolean };

let host: StubNavigationHost;
let featureFlag: ReturnType<typeof vi.spyOn>;

function mountWith({
  flag,
  isLoading = false,
}: {
  flag: FlagAnswer;
  isLoading?: boolean;
}) {
  const organization = { id: "org_1", name: "Acme", teams: [] };
  host = StubNavigationHost.create({
    organization,
    organizations: [organization],
    isLoading,
    flags: { [NAVIGATION_FLAG]: flag },
  });
  featureFlag = vi.spyOn(host, "featureFlag");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NavigationHostProvider value={host}>{children}</NavigationHostProvider>
  );
  return renderHook(() => useNavigationMode(), { wrapper });
}

/** Whether the hook asked the host for the flag at all. */
function flagQueryRan(): boolean {
  return featureFlag.mock.calls.length > 0;
}

const STORAGE_KEY = "langwatch:navigation-mode:v1";
const FLAG_STORAGE_KEY = "langwatch:navigation-mode-flag:v1";

beforeEach(() => {
  localStorage.clear();
  useNavigationModeStore.setState({
    storedMode: null,
    isLastKnownFlagEnabled: null,
  });
});

describe("useNavigationMode", () => {
  describe("when the device picked nothing and the flag is on", () => {
    /** @scenario "A device with no stored preference runs the product switcher" */
    it("resolves to the product switcher", () => {
      const { result } = mountWith({ flag: { enabled: true, isLoading: false } });

      expect(result.current).toEqual({
        status: "ready",
        mode: "product-switcher",
      });
    });
  });

  describe("when the device picked nothing and the flag has not answered", () => {
    /** @scenario "A device with no stored preference keeps the old navigation until the flag answers" */
    it("resolves to legacy without a loading screen", () => {
      const { result } = mountWith({ flag: { enabled: false, isLoading: true } });

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
    });

    /** @scenario "A device that saw the flag on paints the new navigation first" */
    it("resolves to the product switcher when the flag was on last time", () => {
      useNavigationModeStore.setState({ isLastKnownFlagEnabled: true });

      const { result } = mountWith({ flag: { enabled: false, isLoading: true } });

      expect(result.current).toEqual({
        status: "ready",
        mode: "product-switcher",
      });
    });
  });

  describe("when the flag answers", () => {
    it("remembers the answer for the next visit", () => {
      mountWith({ flag: { enabled: true, isLoading: false } });

      expect(localStorage.getItem(FLAG_STORAGE_KEY)).toBe("on");
      expect(useNavigationModeStore.getState().isLastKnownFlagEnabled).toBe(true);
    });
  });

  describe("when the device stored legacy", () => {
    /** @scenario A device set to legacy never waits for the flag */
    it("resolves to legacy immediately without a flag check", () => {
      useNavigationModeStore.setState({ storedMode: "legacy" });

      const { result } = mountWith({ flag: { enabled: true, isLoading: true } });

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
      expect(flagQueryRan()).toBe(false);
    });
  });

  describe("when the device stored a v2 mode and the flag has not answered", () => {
    /** @scenario A device set to a new mode waits for the flag instead of flashing the old chrome */
    it("stays loading instead of resolving to any chrome", () => {
      useNavigationModeStore.setState({ storedMode: "product-switcher" });

      const { result } = mountWith({ flag: { enabled: false, isLoading: true } });

      expect(result.current).toEqual({ status: "loading" });
    });

    it("stays loading while the organization is still resolving", () => {
      useNavigationModeStore.setState({ storedMode: "product-switcher" });

      const { result } = mountWith({
        flag: { enabled: false, isLoading: false },
        isLoading: true,
      });

      expect(result.current).toEqual({ status: "loading" });
    });
  });

  describe("when the flag is on", () => {
    /** @scenario The flag on honours the stored mode */
    it("resolves to the stored mode", () => {
      useNavigationModeStore.setState({ storedMode: "icon-rail" });

      const { result } = mountWith({ flag: { enabled: true, isLoading: false } });

      expect(result.current).toEqual({ status: "ready", mode: "icon-rail" });
    });
  });

  describe("when the flag is off", () => {
    /** @scenario The flag off falls back to legacy and keeps the preference */
    it("resolves to legacy and keeps the stored preference", () => {
      useNavigationModeStore.getState().setStoredMode("product-switcher");

      const { result } = mountWith({ flag: { enabled: false, isLoading: false } });

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
      expect(localStorage.getItem(STORAGE_KEY)).toBe("product-switcher");
      expect(useNavigationModeStore.getState().storedMode).toBe("product-switcher");
    });
  });
});

describe("navigationModeStore", () => {
  describe("when storage holds garbage", () => {
    /** @scenario "Garbage in storage counts as no stored choice" */
    it("loads as no pick at all", () => {
      localStorage.setItem(STORAGE_KEY, "banana");
      expect(loadStoredNavigationMode()).toBeNull();
    });
  });

  describe("when a mode is picked", () => {
    /** @scenario Picking a mode persists on the device */
    it("persists the mode for the next visit", () => {
      useNavigationModeStore.getState().setStoredMode("icon-rail");

      expect(localStorage.getItem(STORAGE_KEY)).toBe("icon-rail");
      expect(loadStoredNavigationMode()).toBe("icon-rail");
    });
  });
});
