/**
 * @vitest-environment jsdom
 *
 * Spec: modules/navigation/specs/product-sidebars.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  honourDashboardsSidebarHint,
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
    expect(readDashboardsSidebarHint({ projectId: "proj_a" })).toBeNull();
  });

  /** @scenario Refreshing a dashboard keeps the sidebar it was opened with */
  it("survives a re-read from the tab's session storage", () => {
    writeDashboardsSidebarHint({ hint: "llm-ops", projectId: "proj_a" });
    expect(readDashboardsSidebarHint({ projectId: "proj_a" })).toBe("llm-ops");
  });

  it("ignores a stored value that is not a hint", () => {
    sessionStorage.setItem(
      "langwatch:nav:dashboards-sidebar-hint:v2",
      JSON.stringify({ hint: "gateway", projectId: "proj_a" }),
    );
    expect(readDashboardsSidebarHint({ projectId: "proj_a" })).toBeNull();
  });

  it("tells subscribers only when the hint changes", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToDashboardsSidebarHint(onChange);
    writeDashboardsSidebarHint({ hint: "dashboards", projectId: "proj_a" });
    writeDashboardsSidebarHint({ hint: "dashboards", projectId: "proj_a" });
    unsubscribe();
    writeDashboardsSidebarHint({ hint: "llm-ops", projectId: "proj_a" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /** @scenario A sidebar hint from another project is ignored */
  it("ignores a hint written in another project", () => {
    writeDashboardsSidebarHint({ hint: "llm-ops", projectId: "proj_a" });
    expect(readDashboardsSidebarHint({ projectId: "proj_b" })).toBeNull();
  });

  /** @scenario A sidebar hint for an unreachable LLM Ops is ignored */
  it("drops an llm-ops hint when LLM Ops is not reachable", () => {
    expect(
      honourDashboardsSidebarHint({ hint: "llm-ops", reachableProducts: ["gateway"] }),
    ).toBeNull();
    expect(honourDashboardsSidebarHint({ hint: "llm-ops", reachableProducts: ["llm-ops"] })).toBe(
      "llm-ops",
    );
    expect(honourDashboardsSidebarHint({ hint: "dashboards", reachableProducts: [] })).toBe(
      "dashboards",
    );
  });
});
