/**
 * @vitest-environment node
 * Read route authorizes by object purpose (traces:view vs scenarios:view).
 */
import { describe, expect, it } from "vitest";
import { requiredPermissionForPurpose } from "../stored-object-file.rest.ts";

describe("requiredPermissionForPurpose", () => {
  describe("given a trace-content object", () => {
    it("requires traces:view", () => {
      expect(requiredPermissionForPurpose("trace_content")).toBe("traces:view");
    });
  });

  describe("given scenario purposes", () => {
    it("requires scenarios:view", () => {
      expect(requiredPermissionForPurpose("scenario_attachment")).toBe("scenarios:view");
      expect(requiredPermissionForPurpose("scenario_event_content")).toBe("scenarios:view");
    });
  });
});
