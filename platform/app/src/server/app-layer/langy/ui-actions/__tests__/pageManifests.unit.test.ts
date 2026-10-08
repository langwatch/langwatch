/**
 * @vitest-environment node
 *
 * The server's registry decides which UI actions exist and under which page
 * family. The dashboard page contributes `dashboard.getWidgetRender`, and the
 * `dashboard` context chip is what advertises that channel to a turn.
 *
 * @see specs/analytics/dashboard-widget-render-receipt.feature
 */

import { describe, expect, it } from "vitest";

import {
  CHIP_KIND_TO_MANIFEST,
  findPageAction,
  listPageActions,
} from "../pageManifests";

describe("page action manifests", () => {
  describe("when the dashboard render action is looked up", () => {
    it("resolves dashboard.getWidgetRender with its schema and permission", () => {
      const action = findPageAction("dashboard.getWidgetRender");
      expect(action).not.toBeNull();
      expect(action?.requiredPermission).toBe("analytics:view");
      expect(action?.backend).toBe("read");
      expect(action?.payloadSchema).toBeDefined();
    });

    it("is included in the listing of every dispatchable kind", () => {
      const kinds = listPageActions().map((a) => a.kind);
      expect(kinds).toContain("dashboard.getWidgetRender");
      // The workbench family still registers alongside it.
      expect(kinds).toContain("workbench.getState");
    });
  });

  describe("when an unknown kind is looked up", () => {
    it("returns null rather than a partial match", () => {
      expect(findPageAction("dashboard.nope")).toBeNull();
      expect(findPageAction("nosuchdomain.action")).toBeNull();
    });
  });

  describe("the context-chip to manifest mapping", () => {
    it("routes the dashboard chip to the dashboard manifest", () => {
      expect(CHIP_KIND_TO_MANIFEST.dashboard).toBe("dashboard");
      expect(CHIP_KIND_TO_MANIFEST.experiment).toBe("workbench");
    });
  });
});
