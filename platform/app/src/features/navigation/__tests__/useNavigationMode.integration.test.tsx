/**
 * @vitest-environment jsdom
 *
 * The navigation-mode resolution contract: legacy resolves synchronously
 * with no flag check, a stored v2 mode waits for the flag instead of
 * flashing the old chrome, and flag off falls back to legacy without
 * erasing the device preference.
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
  useNavigationModeStore.setState({ storedMode: "legacy" });
});

describe("useNavigationMode", () => {
  describe("when the device has no stored preference", () => {
    /** @scenario A device with no stored preference stays on the old navigation */
    it("resolves to legacy immediately without a flag check", () => {
      const { result } = renderHook(() => useNavigationMode());

      expect(result.current).toEqual({ status: "ready", mode: "legacy" });
      expect(flagQueryRan()).toBe(false);
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
    /** @scenario Garbage in storage counts as legacy */
    it("loads as legacy", () => {
      localStorage.setItem(STORAGE_KEY, "banana");
      expect(loadStoredNavigationMode()).toBe("legacy");
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
