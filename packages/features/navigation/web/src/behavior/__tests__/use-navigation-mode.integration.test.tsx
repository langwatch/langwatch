/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  loadStoredNavigationMode,
  NAVIGATION_MODE_STORAGE_KEY,
  useNavigationModeStore,
} from "../navigation-mode.store";
import { useNavigationMode } from "../use-navigation-mode";

const STORAGE_KEY = NAVIGATION_MODE_STORAGE_KEY;

beforeEach(() => {
  localStorage.clear();
  useNavigationModeStore.setState({ storedMode: null });
});

describe("useNavigationMode", () => {
  describe("when the device picked nothing", () => {
    /** @scenario A device with no stored preference runs the product switcher */
    it("resolves to the product switcher", () => {
      const { result } = renderHook(() => useNavigationMode());
      expect(result.current).toBe("product-switcher");
    });
  });

  describe("when the device stored a mode", () => {
    /** @scenario The stored mode decides the shell */
    it("resolves to the stored mode after mount", async () => {
      localStorage.setItem(STORAGE_KEY, "icon-rail");

      const { result, rerender } = renderHook(() => useNavigationMode());

      await act(async () => {
        rerender();
      });
      expect(result.current).toBe("icon-rail");
    });
  });

  describe("when localStorage carries a mode before the first render", () => {
    /**
     * The first client render must match the server render. The server has
     * no localStorage, so it renders the default. If the store read
     * localStorage at module init instead, an icon-rail reader would
     * hydrate the wrong shell against the server's product-switcher DOM.
     *
     * @scenario The first client frame matches the server default and the stored mode applies after mount
     */
    it("renders the default on the first frame and the stored mode after mount", async () => {
      localStorage.setItem(STORAGE_KEY, "icon-rail");

      let firstFrame: string | undefined;
      const { result, rerender } = renderHook(() => {
        const mode = useNavigationMode();
        firstFrame ??= mode;
        return mode;
      });

      expect(firstFrame).toBe("product-switcher");

      // The mount effect runs after the first paint; a rerender picks up
      // the applied stored mode.
      await act(async () => {
        rerender();
      });
      expect(result.current).toBe("icon-rail");
    });
  });
});

describe("navigationModeStore", () => {
  describe("when storage holds garbage", () => {
    /** @scenario Garbage in storage counts as no stored choice */
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
