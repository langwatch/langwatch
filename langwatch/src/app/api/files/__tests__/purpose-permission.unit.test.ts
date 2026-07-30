/**
 * @vitest-environment node
 *
 * The stored-objects read route authorizes by the OBJECT's purpose, not by a
 * single hardwired permission: trace media guards on `traces:view`, scenario
 * media on `scenarios:view` — separate permission categories that custom
 * roles can grant independently. This pins the mapping the route's
 * post-read gate (`authorizeFilePurpose`) applies.
 */
import { describe, expect, it } from "vitest";
import { requiredPermissionForPurpose } from "../[[...route]]/app";

describe("requiredPermissionForPurpose", () => {
  describe("given a trace-content object", () => {
    it("requires traces:view", () => {
      expect(requiredPermissionForPurpose("trace_content")).toBe("traces:view");
    });
  });

  describe("given scenario purposes", () => {
    it("requires scenarios:view", () => {
      expect(requiredPermissionForPurpose("scenario_attachment")).toBe(
        "scenarios:view",
      );
      expect(requiredPermissionForPurpose("scenario_event_content")).toBe(
        "scenarios:view",
      );
    });
  });
});
