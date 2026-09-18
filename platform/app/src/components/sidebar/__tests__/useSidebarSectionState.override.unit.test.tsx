/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/tracking", () => ({ trackEvent: vi.fn() }));

import { useSidebarSectionOverrides } from "../sidebarSectionOverrides";
import {
  getSidebarSectionStorageKey,
  useSidebarSectionState,
} from "../useSidebarSectionState";

const hook = () =>
  renderHook(() =>
    useSidebarSectionState({
      id: "library",
      label: "Build",
      defaultExpanded: false,
    }),
  );

describe("sidebar section override", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSidebarSectionOverrides.getState().clearAll();
  });

  describe("given the user had the group expanded", () => {
    /** @scenario Build folds before the first step and is restored at the end */
    it("folds under a collapse override and comes back expanded when it clears", () => {
      window.localStorage.setItem(
        getSidebarSectionStorageKey("library"),
        "true",
      );
      const { result } = hook();
      expect(result.current.isExpanded).toBe(true);
      act(() =>
        useSidebarSectionOverrides.getState().setOverride("library", false),
      );
      expect(result.current.isExpanded).toBe(false);
      act(() =>
        useSidebarSectionOverrides.getState().setOverride("library", true),
      );
      expect(result.current.isExpanded).toBe(true);
      act(() => useSidebarSectionOverrides.getState().clearAll());
      expect(result.current.isExpanded).toBe(true);
      expect(
        window.localStorage.getItem(getSidebarSectionStorageKey("library")),
      ).toBe("true");
    });
  });

  describe("given the user had the group collapsed", () => {
    /** @scenario Build was collapsed before the tour and stays collapsed after it */
    it("opens under an expand override and folds again when it clears", () => {
      const { result } = hook();
      expect(result.current.isExpanded).toBe(false);
      act(() =>
        useSidebarSectionOverrides.getState().setOverride("library", true),
      );
      expect(result.current.isExpanded).toBe(true);
      act(() => useSidebarSectionOverrides.getState().clearAll());
      expect(result.current.isExpanded).toBe(false);
      expect(
        window.localStorage.getItem(getSidebarSectionStorageKey("library")),
      ).toBeNull();
    });
  });
});
