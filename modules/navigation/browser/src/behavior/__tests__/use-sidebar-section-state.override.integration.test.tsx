/**
 * @vitest-environment jsdom
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { sidebarHostService } from "../sidebar-host-service.ts";
import {
  getSidebarSectionStorageKey,
  useSidebarSectionState,
} from "../use-sidebar-section-state.ts";

const hook = () =>
  renderHook(() => useSidebarSectionState({ id: "library", defaultExpanded: false }));

describe("sidebar section override", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sidebarHostService.restoreAll();
  });

  describe("given the user had the group expanded", () => {
    /** @scenario Build folds before the first step and is restored at the end */
    it("folds under a collapse override and comes back expanded when it clears", () => {
      window.localStorage.setItem(getSidebarSectionStorageKey("library"), "true");
      const { result } = hook();
      expect(result.current.isExpanded).toBe(true);

      act(() => sidebarHostService.collapseGroup("library"));
      expect(result.current.isExpanded).toBe(false);

      act(() => sidebarHostService.expandGroup("library"));
      expect(result.current.isExpanded).toBe(true);

      act(() => sidebarHostService.restoreAll());
      expect(result.current.isExpanded).toBe(true);
      expect(window.localStorage.getItem(getSidebarSectionStorageKey("library"))).toBe("true");
    });
  });

  describe("given the user had the group collapsed", () => {
    /** @scenario Build was collapsed before the tour and stays collapsed after it */
    it("opens under an expand override and folds again when it clears", () => {
      const { result } = hook();
      expect(result.current.isExpanded).toBe(false);

      act(() => sidebarHostService.expandGroup("library"));
      expect(result.current.isExpanded).toBe(true);

      act(() => sidebarHostService.restoreAll());
      expect(result.current.isExpanded).toBe(false);
      expect(window.localStorage.getItem(getSidebarSectionStorageKey("library"))).toBeNull();
    });
  });
});
