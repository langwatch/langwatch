import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { authzServerConfigDefinition } from "../authz.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "authz", definition: authzServerConfigDefinition, source }).value;

describe("authz server configuration", () => {
  describe("given the epoch cache switch carries the deployment's own spelling", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads 1 and true as on and everything else as off", () => {
      expect(read({ AUTHZ_EPOCH_CACHE: "1" }).epochCacheEnabled).toBe(true);
      expect(read({ AUTHZ_EPOCH_CACHE: "true" }).epochCacheEnabled).toBe(true);
      expect(read({}).epochCacheEnabled).toBe(false);
    });
  });

  describe("given a demo project id is exported blank", () => {
    /** @scenario "A blank identifier resolves to absent rather than to an empty filter" */
    it("resolves it to absent so no filter is widened", () => {
      expect(read({ DEMO_PROJECT_ID: "  " }).demoProjectId).toBeUndefined();
      expect(read({ DEMO_PROJECT_USER_ID: "" }).demoProjectUserId).toBeUndefined();
      expect(read({ DEMO_PROJECT_ID: "project-1" }).demoProjectId).toBe("project-1");
    });
  });
});
