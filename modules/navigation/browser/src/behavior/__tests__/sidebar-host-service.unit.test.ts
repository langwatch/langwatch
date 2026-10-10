import { beforeEach, describe, expect, it, vi } from "vitest";

import { sidebarHostService } from "../sidebar-host-service.ts";
import {
  clearSidebarSectionOverrides,
  getSidebarSectionOverride,
  subscribeSidebarSectionOverrides,
} from "../sidebar-section-store.ts";

describe("sidebarHostService", () => {
  beforeEach(() => {
    clearSidebarSectionOverrides();
  });

  it("expandGroup sets the override true and notifies subscribers", () => {
    const listener = vi.fn();
    subscribeSidebarSectionOverrides(listener);

    sidebarHostService.expandGroup("build");

    expect(getSidebarSectionOverride("build")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("collapseGroup sets the override false", () => {
    sidebarHostService.collapseGroup("build");

    expect(getSidebarSectionOverride("build")).toBe(false);
  });

  it("restoreAll drops every override", () => {
    sidebarHostService.expandGroup("build");
    sidebarHostService.expandGroup("workflows");

    sidebarHostService.restoreAll();

    expect(getSidebarSectionOverride("build")).toBeUndefined();
    expect(getSidebarSectionOverride("workflows")).toBeUndefined();
  });
});
