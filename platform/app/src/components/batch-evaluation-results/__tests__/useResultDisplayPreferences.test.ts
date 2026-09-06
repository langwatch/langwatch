/**
 * Tests for useResultDisplayPreferences
 *
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useResultDisplayPreferences } from "../useResultDisplayPreferences";

describe("useResultDisplayPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("when toggling a field", () => {
    it("flips only the requested field", () => {
      const { result } = renderHook(() => useResultDisplayPreferences());

      act(() => result.current.toggleField("scores"));

      expect(result.current.fields.scores).toBe(false);
      expect(result.current.fields.outputs).toBe(true);
      expect(result.current.fields.costAndLatency).toBe(true);
    });
  });

  describe("when a new session starts", () => {
    /** @scenario Field visibility does not persist across reloads */
    it("resets field visibility to defaults", () => {
      const first = renderHook(() => useResultDisplayPreferences());
      act(() => first.result.current.toggleField("scores"));
      expect(first.result.current.fields.scores).toBe(false);
      first.unmount();

      // A fresh hook instance stands in for a reload — fields hold no
      // storage key, so nothing carries over.
      const second = renderHook(() => useResultDisplayPreferences());
      expect(second.result.current.fields.scores).toBe(true);
    });

    /** @scenario Row height choice persists across reloads */
    it("keeps the row height choice", () => {
      const first = renderHook(() => useResultDisplayPreferences());
      act(() => first.result.current.setRowHeight("l"));
      expect(first.result.current.rowHeight).toBe("l");
      first.unmount();

      const second = renderHook(() => useResultDisplayPreferences());
      expect(second.result.current.rowHeight).toBe("l");
    });
  });
});
