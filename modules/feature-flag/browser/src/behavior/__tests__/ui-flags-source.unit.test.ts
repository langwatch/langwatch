import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import { currentScopeTarget, uiFlagsFrom } from "../ui-flags-source.ts";

describe("currentScopeTarget", () => {
  describe("when the scope names a project in an organization", () => {
    it("targets the project", () => {
      expect(currentScopeTarget({ organizationId: "org_1", projectId: "proj_1" })).toEqual({
        kind: "project",
        projectId: "proj_1",
        organizationId: "org_1",
      });
    });
  });

  describe("when the scope names only an organization", () => {
    it("targets the organization", () => {
      expect(currentScopeTarget({ organizationId: "org_1", projectId: null })).toEqual({
        kind: "organization",
        organizationId: "org_1",
      });
    });
  });

  describe("when the scope names nothing", () => {
    it("targets the signed-in user", () => {
      expect(currentScopeTarget({ organizationId: null, projectId: null })).toEqual({
        kind: "user",
      });
    });
  });
});

describe("uiFlagsFrom", () => {
  const flag = FrontendFlags.release_ui_ai_governance_enabled;
  const other = FrontendFlags.release_ui_ai_gateway_menu_enabled;

  describe("when the read has not answered yet", () => {
    it("reads every flag as not yet answered", () => {
      expect(uiFlagsFrom({ flags: void 0, overrides: {}, isFailed: false }).flag(flag)).toBe(
        void 0,
      );
    });
  });

  describe("when the read was refused", () => {
    /** @scenario "A refused browser flag read answers every flag off" */
    it("reads every flag as off and keeps this browser's overrides", () => {
      const flags = uiFlagsFrom({
        flags: void 0,
        overrides: { release_ui_ai_gateway_menu_enabled: true },
        isFailed: true,
      });

      expect(flags.flag(flag)).toBe(false);
      expect(flags.flag(other)).toBe(true);
    });
  });
});
