/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  loadStoredNavigationMode,
  useNavigationModeStore,
} from "../navigationModeStore";
import { useNavigationMode } from "../useNavigationMode";

const STORAGE_KEY = "langwatch:navigation-mode:v1";

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
    it("resolves to the stored mode", () => {
      useNavigationModeStore.setState({ storedMode: "icon-rail" });

      const { result } = renderHook(() => useNavigationMode());

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
