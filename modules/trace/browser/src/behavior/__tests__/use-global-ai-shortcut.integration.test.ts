/**
 * @vitest-environment jsdom
 *
 * The Explorer's ⌘I listener, which steps aside when Langy owns the key.
 * @see specs/traces-v2/search.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGlobalAiShortcut } from "../use-global-ai-shortcut.ts";

function pressCmdI(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "i",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useGlobalAiShortcut", () => {
  describe("when Langy is not available", () => {
    /** @scenario "Without Langy the ⌘I shortcut opens the Ask AI bar" */
    it("answers ⌘I and claims the key", () => {
      const onTrigger = vi.fn();
      renderHook(() => useGlobalAiShortcut(onTrigger));
      const event = pressCmdI();
      expect(onTrigger).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("when Langy is available", () => {
    /** @scenario "With Langy available the ⌘I shortcut belongs to the Langy panel" */
    it("leaves ⌘I alone, so only the panel's own listener answers it", () => {
      const onTrigger = vi.fn();
      renderHook(() => useGlobalAiShortcut(onTrigger, { enabled: false }));
      const event = pressCmdI();
      expect(onTrigger).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
