/**
 * @vitest-environment jsdom
 *
 * Spec: modules/navigation/specs/product-sidebars.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDashboardsSidebarHint,
  subscribeToDashboardsSidebarHint,
  writeDashboardsSidebarHint,
} from "../dashboards-sidebar-hint.ts";

beforeEach(() => {
  sessionStorage.clear();
});

describe("dashboards sidebar hint", () => {
  /** @scenario A deep link to a dashboard draws the Dashboards sidebar */
  it("is empty in a tab that never wrote one", () => {
    expect(readDashboardsSidebarHint()).toBeNull();
  });

  /** @scenario Refreshing a dashboard keeps the sidebar it was opened with */
  it("survives a re-read from the tab's session storage", () => {
    writeDashboardsSidebarHint({ hint: "llm-ops" });
    expect(readDashboardsSidebarHint()).toBe("llm-ops");
  });

  it("ignores a stored value that is not a hint", () => {
    sessionStorage.setItem("langwatch:nav:dashboards-sidebar-hint:v1", "gateway");
    expect(readDashboardsSidebarHint()).toBeNull();
  });

  it("tells subscribers only when the hint changes", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToDashboardsSidebarHint(onChange);
    writeDashboardsSidebarHint({ hint: "dashboards" });
    writeDashboardsSidebarHint({ hint: "dashboards" });
    unsubscribe();
    writeDashboardsSidebarHint({ hint: "llm-ops" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
