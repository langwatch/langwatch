/**
 * @vitest-environment jsdom
 *
 * The navigation-mode resolution contract: a picked legacy resolves
 * synchronously with no flag check, a picked v2 mode waits for the flag
 * instead of flashing the old chrome, a device that picked nothing
 * follows the flag without ever waiting, and flag off falls back to
 * legacy without erasing the device preference.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useFeatureFlagMock = vi.fn();
const useOrganizationTeamProjectMock = vi.fn();

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: (...args: unknown[]) =>
    useOrganizationTeamProjectMock(...args),
}));

import {
  loadStoredNavigationMode,
  useNavigationModeStore,
} from "../navigationModeStore";
import { useNavigationMode } from "../useNavigationMode";

const STORAGE_KEY = "langwatch:navigation-mode:v1";
const FLAG_STORAGE_KEY = "langwatch:navigation-mode-flag:v1";

function flagQueryRan(): boolean {
  return useFeatureFlagMock.mock.calls.some(
    (call) => (call[1] as { enabled?: boolean } | undefined)?.enabled !== false,
  );
}

beforeEach(() => {
  localStorage.clear();
  useFeatureFlagMock.mockReset();
  useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: false });
  useOrganizationTeamProjectMock.mockReset();
  useOrganizationTeamProjectMock.mockReturnValue({
    organization: { id: "org_1" },
    isLoading: false,
  });
  useNavigationModeStore.setState({ storedMode: null, lastKnownFlag: null });
});

describe("useNavigationMode", () => {
  describe("when the device picked nothing and the flag is on", () => {
    /** @scenario "A device with no stored preference runs the product switcher" */
    it("resolves to the product switcher", () => {
      useFeatureFlagMock.mockReturnValue({ enabled: true, isLoading: false });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({
        status: "ready",
        mode: "product-switcher",
      });
    });
  });

  describe("when the device picked nothing and the flag has not answered", () => {
    /** @scenario "A device with no stored preference and the flag off keeps the old navigation" */
    it("resolves to legacy without a loading screen", () => {
      useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: true });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
    });

    /** @scenario "A device that saw the flag on paints the new navigation first" */
    it("resolves to the product switcher when the flag was on last time", () => {
      useNavigationModeStore.setState({ lastKnownFlag: true });
      useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: true });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({
        status: "ready",
        mode: "product-switcher",
      });
    });
  });

  describe("when the flag answers", () => {
    it("remembers the answer for the next visit", () => {
      useFeatureFlagMock.mockReturnValue({ enabled: true, isLoading: false });

      renderHook(() => useNavigationMode());

      expect(localStorage.getItem(FLAG_STORAGE_KEY)).toBe("on");
      expect(useNavigationModeStore.getState().lastKnownFlag).toBe(true);
    });
  });

  describe("when the device stored legacy", () => {
    /** @scenario A device set to legacy never waits for the flag */
    it("resolves to legacy immediately without a flag check", () => {
      useNavigationModeStore.setState({ storedMode: "legacy" });
      useFeatureFlagMock.mockReturnValue({ enabled: true, isLoading: true });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
      expect(flagQueryRan()).toBe(false);
    });
  });

  describe("when the device stored a v2 mode and the flag has not answered", () => {
    /** @scenario A device set to a new mode waits for the flag instead of flashing the old chrome */
    it("stays loading instead of resolving to any chrome", () => {
      useNavigationModeStore.setState({ storedMode: "product-switcher" });
      useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: true });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "loading" });
    });

    it("stays loading while the organization is still resolving", () => {
      useNavigationModeStore.setState({ storedMode: "product-switcher" });
      useOrganizationTeamProjectMock.mockReturnValue({
        organization: undefined,
        isLoading: true,
      });
      useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: false });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "loading" });
      expect(flagQueryRan()).toBe(false);
    });
  });

  describe("when the flag is on", () => {
    /** @scenario The flag on honours the stored mode */
    it("resolves to the stored mode", () => {
      useNavigationModeStore.setState({ storedMode: "icon-rail" });
      useFeatureFlagMock.mockReturnValue({ enabled: true, isLoading: false });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "ready", mode: "icon-rail" });
    });
  });

  describe("when the flag is off", () => {
    /** @scenario The flag off falls back to legacy and keeps the preference */
    it("resolves to legacy and keeps the stored preference", () => {
      useNavigationModeStore.getState().setStoredMode("product-switcher");
      useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: false });

      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
      expect(localStorage.getItem(STORAGE_KEY)).toBe("product-switcher");
      expect(useNavigationModeStore.getState().storedMode).toBe(
        "product-switcher",
      );
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
