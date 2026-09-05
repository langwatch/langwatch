/**
 * Spec: specs/traces-v2/presence-toggle-placement.feature
 */
import { describe, expect, it } from "vitest";

import { showsPresenceMenuItem } from "../presence-menu-gate";

describe("showsPresenceMenuItem()", () => {
  describe("when the reader is on the Trace Explorer", () => {
    it("offers the toggle, on the lens and on a trace opened inside it", () => {
      expect(showsPresenceMenuItem("/:project/traces")).toBe(true);
      expect(showsPresenceMenuItem("/:project/traces/:traceId")).toBe(true);
    });
  });

  describe("when the reader is anywhere else", () => {
    it("offers nothing, rather than a toggle that broadcasts from no lens", () => {
      expect(showsPresenceMenuItem("/:project/analytics")).toBe(false);
      expect(showsPresenceMenuItem("/settings")).toBe(false);
      expect(showsPresenceMenuItem("/:project/traces-archive")).toBe(false);
    });
  });
});
