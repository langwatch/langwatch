/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { sidebarHostService } from "../sidebar-host-service.ts";
import { clearSidebarSectionOverrides } from "../sidebar-section-store.ts";
import { useSidebarSectionState } from "../use-sidebar-section-state.ts";

describe("useSidebarSectionState", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearSidebarSectionOverrides();
  });

  it("reads the sidebar capability's override over the remembered preference", () => {
    const { result, rerender } = renderHook(() =>
      useSidebarSectionState({ id: "build", defaultExpanded: false }),
    );
    expect(result.current.isExpanded).toBe(false);

    sidebarHostService.expandGroup("build");
    rerender();

    expect(result.current.isExpanded).toBe(true);
  });

  it("starts from the remembered preference, with no collapsed first paint", () => {
    window.localStorage.setItem("langwatch:main-sidebar-section:build:expanded:v1", "true");

    const { result } = renderHook(() =>
      useSidebarSectionState({ id: "build", defaultExpanded: false }),
    );

    expect(result.current.isExpanded).toBe(true);
  });

  it("restoreAll falls back to the remembered preference", () => {
    const { result, rerender } = renderHook(() =>
      useSidebarSectionState({ id: "build", defaultExpanded: false }),
    );
    sidebarHostService.expandGroup("build");
    rerender();
    expect(result.current.isExpanded).toBe(true);

    sidebarHostService.restoreAll();
    rerender();

    expect(result.current.isExpanded).toBe(false);
  });
});
