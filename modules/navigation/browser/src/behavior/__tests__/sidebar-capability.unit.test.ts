import { beforeEach, describe, expect, it, vi } from "vitest";

import { sidebarCapability } from "../sidebar-capability.ts";
import {
  clearSidebarSectionOverrides,
  getSidebarSectionOverride,
  subscribeSidebarSectionOverrides,
} from "../sidebar-section-store.ts";

describe("sidebarCapability", () => {
  beforeEach(() => {
    clearSidebarSectionOverrides();
  });

  it("expandGroup sets the override true and notifies subscribers", () => {
    const listener = vi.fn();
    subscribeSidebarSectionOverrides(listener);

    sidebarCapability.expandGroup("build");

    expect(getSidebarSectionOverride("build")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("collapseGroup sets the override false", () => {
    sidebarCapability.collapseGroup("build");

    expect(getSidebarSectionOverride("build")).toBe(false);
  });

  it("restoreAll drops every override", () => {
    sidebarCapability.expandGroup("build");
    sidebarCapability.expandGroup("workflows");

    sidebarCapability.restoreAll();

    expect(getSidebarSectionOverride("build")).toBeUndefined();
    expect(getSidebarSectionOverride("workflows")).toBeUndefined();
  });
});
