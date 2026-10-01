/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWarnBeforeReload } from "../use-warn-before-reload.ts";

/** Fires an unload the way the browser does and reports whether it was held. */
function unloadIsHeld(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("given a prompt tab", () => {
  describe("when it has unsaved changes", () => {
    /** @scenario Reloading with unsaved prompt changes asks first */
    it("asks before the page unloads", () => {
      renderHook(() => useWarnBeforeReload({ isUnsaved: true }));

      expect(unloadIsHeld()).toBe(true);
    });

    /** @scenario Reloading with unsaved prompt changes asks first */
    it("stops asking once the changes are saved", () => {
      const { rerender } = renderHook(
        ({ isUnsaved }: { isUnsaved: boolean }) => useWarnBeforeReload({ isUnsaved }),
        { initialProps: { isUnsaved: true } },
      );

      rerender({ isUnsaved: false });

      expect(unloadIsHeld()).toBe(false);
    });
  });

  describe("when it has nothing unsaved", () => {
    /** @scenario Reloading with unsaved prompt changes asks first */
    it("lets the page unload", () => {
      renderHook(() => useWarnBeforeReload({ isUnsaved: false }));

      expect(unloadIsHeld()).toBe(false);
    });
  });
});
