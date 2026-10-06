/**
 * @vitest-environment jsdom
 *
 * Spec: modules/navigation/specs/navigation-modes.feature
 */

import { clearReaderUiStorage, setUiStorageReader } from "@langwatch/browser-host/storage";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { NAVIGATION_MODE_SLICE, useNavigationModeStore } from "../navigation-mode.store.ts";
import { useNavigationMode } from "../use-navigation-mode.ts";

const READER = "reader-1";
const STORAGE_KEY = `langwatch:user:${READER}:${NAVIGATION_MODE_SLICE}`;

function signIn() {
  act(() => setUiStorageReader(READER));
}

beforeEach(() => {
  clearReaderUiStorage();
  localStorage.clear();
  useNavigationModeStore.setState(useNavigationModeStore.getInitialState(), true);
});

describe("useNavigationMode", () => {
  describe("when the reader picked nothing", () => {
    /** @scenario A device with no stored preference runs the product switcher */
    it("resolves to the product switcher", () => {
      signIn();
      const { result } = renderHook(() => useNavigationMode());
      expect(result.current).toBe("product-switcher");
    });
  });

  describe("when the reader stored a mode", () => {
    /** @scenario The stored mode decides the shell */
    it("resolves to the stored mode", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { storedMode: "icon-rail" } }));
      signIn();

      const { result } = renderHook(() => useNavigationMode());
      expect(result.current).toBe("icon-rail");
    });
  });

  describe("when storage holds garbage", () => {
    /** @scenario Garbage in storage counts as no stored choice */
    it("resolves to the product switcher", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { storedMode: "banana" } }));
      signIn();

      const { result } = renderHook(() => useNavigationMode());
      expect(result.current).toBe("product-switcher");
    });
  });
});

describe("navigationModeStore", () => {
  describe("when a mode is picked", () => {
    /** @scenario Picking a mode persists on the device */
    it("persists the mode for the reader's next visit", () => {
      signIn();
      useNavigationModeStore.getState().setStoredMode("icon-rail");

      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
        state: { storedMode: "icon-rail" },
      });
    });
  });
});
