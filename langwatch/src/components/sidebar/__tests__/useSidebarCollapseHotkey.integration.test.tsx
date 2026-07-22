/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/sidebar-collapse-preference.feature
 *      (scenarios under "keyboard")
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSidebarCollapseHotkey } from "../useSidebarCollapseHotkey";

// jsdom reports no platform, so getIsMac() is false and the hook listens
// for Ctrl+B — dispatch accordingly.
const pressCtrlB = (target?: HTMLElement) => {
  const event = new KeyboardEvent("keydown", {
    key: "b",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    (target ?? window).dispatchEvent(event);
  });
  return event;
};

describe("useSidebarCollapseHotkey", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  describe("when the shortcut fires", () => {
    /** @scenario The sidebar toggles from the keyboard */
    it("toggles the collapse preference", () => {
      const setCollapsed = vi.fn();
      renderHook(() =>
        useSidebarCollapseHotkey({
          enabled: true,
          isCollapsed: false,
          setCollapsed,
        }),
      );

      const event = pressCtrlB();

      expect(setCollapsed).toHaveBeenCalledWith(true);
      expect(event.defaultPrevented).toBe(true);
    });

    it("expands when currently collapsed", () => {
      const setCollapsed = vi.fn();
      renderHook(() =>
        useSidebarCollapseHotkey({
          enabled: true,
          isCollapsed: true,
          setCollapsed,
        }),
      );

      pressCtrlB();

      expect(setCollapsed).toHaveBeenCalledWith(false);
    });
  });

  describe("when focus is in a typing surface", () => {
    /** @scenario The shortcut stands down while typing */
    it("does not toggle from an input", () => {
      const setCollapsed = vi.fn();
      renderHook(() =>
        useSidebarCollapseHotkey({
          enabled: true,
          isCollapsed: false,
          setCollapsed,
        }),
      );

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      pressCtrlB(input);

      expect(setCollapsed).not.toHaveBeenCalled();
    });
  });

  describe("when toggling is unavailable (small screens)", () => {
    it("does nothing", () => {
      const setCollapsed = vi.fn();
      renderHook(() =>
        useSidebarCollapseHotkey({
          enabled: false,
          isCollapsed: true,
          setCollapsed,
        }),
      );

      pressCtrlB();

      expect(setCollapsed).not.toHaveBeenCalled();
    });
  });
});
