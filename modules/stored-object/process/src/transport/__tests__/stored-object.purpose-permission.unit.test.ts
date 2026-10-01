/**
 * @vitest-environment node
 * Read route authorizes by object purpose: trace media on `traces:view`,
 * scenario media on `scenarios:view`, a dataset attachment on `datasets:view`.
 */
import { describe, expect, it } from "vitest";

import { requiredPermissionForPurpose } from "../../rules/stored-object-purpose-permission.rules.ts";

describe("requiredPermissionForPurpose", () => {
  describe("given a trace-content object", () => {
    it("requires traces:view", () => {
      expect(requiredPermissionForPurpose("trace_content")).toBe("traces:view");
    });
  });

  describe("given a dataset attachment", () => {
    /** @scenario "Reading a dataset attachment needs permission to view datasets" */
    it("requires datasets:view", () => {
      expect(requiredPermissionForPurpose("dataset_attachment")).toBe("datasets:view");
    });
  });

  describe("given a dataset import", () => {
    it("requires datasets:view", () => {
      expect(requiredPermissionForPurpose("dataset_import")).toBe("datasets:view");
    });
  });

  describe("given a purpose the table does not name", () => {
    it("requires scenarios:view, as every in-process writer's media did before", () => {
      expect(requiredPermissionForPurpose("evaluation_inputs")).toBe("scenarios:view");
      expect(requiredPermissionForPurpose("toString")).toBe("scenarios:view");
    });
  });

  describe("given scenario purposes", () => {
    it("requires scenarios:view", () => {
      expect(requiredPermissionForPurpose("scenario_attachment")).toBe("scenarios:view");
      expect(requiredPermissionForPurpose("scenario_event_content")).toBe("scenarios:view");
    });
  });
});
