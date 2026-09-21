/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { sidebarCapability } from "../sidebar-capability.ts";
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

    sidebarCapability.expandGroup("build");
    rerender();

    expect(result.current.isExpanded).toBe(true);
  });

  it("restoreAll falls back to the remembered preference", () => {
    const { result, rerender } = renderHook(() =>
      useSidebarSectionState({ id: "build", defaultExpanded: false }),
    );
    sidebarCapability.expandGroup("build");
    rerender();
    expect(result.current.isExpanded).toBe(true);

    sidebarCapability.restoreAll();
    rerender();

    expect(result.current.isExpanded).toBe(false);
  });
});
