/**
 * @vitest-environment jsdom
 * A drawer opened from a feature's own state counts as open for whatever rides beside drawers.
 * Spec: specs/langy/langy-panel-layout.feature
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useInPlaceDrawer, useInPlaceDrawerOpen } from "../in-place-drawer.ts";

afterEach(cleanup);

describe("useInPlaceDrawer", () => {
  describe("given no in-place drawer", () => {
    it("reads closed", () => {
      expect(renderHook(() => useInPlaceDrawerOpen()).result.current).toBe(false);
    });
  });

  describe("given two in-place drawers open", () => {
    it("reads open until the last one closes or unmounts", () => {
      const reading = renderHook(() => useInPlaceDrawerOpen());
      const first = renderHook(({ open }) => useInPlaceDrawer({ open }), {
        initialProps: { open: true },
      });
      const second = renderHook(() => useInPlaceDrawer({ open: true }));
      expect(reading.result.current).toBe(true);

      act(() => first.rerender({ open: false }));
      expect(reading.result.current).toBe(true);

      act(() => second.unmount());
      expect(reading.result.current).toBe(false);
    });
  });
});
