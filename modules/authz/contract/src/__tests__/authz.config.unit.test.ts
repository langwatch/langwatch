import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { authzServerConfig } from "../authz.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "authz", config: authzServerConfig }], environment }).authz;

describe("authz server configuration", () => {
  describe("given no operator has touched the epoch cache switch", () => {
    /** @scenario "The grants cache is on unless an operator turns it off" */
    it("leaves the cache on when unset, empty or blank", () => {
      expect(read({}).epochCacheEnabled).toBe(true);
      expect(read({ AUTHZ_EPOCH_CACHE: "" }).epochCacheEnabled).toBe(true);
      expect(read({ AUTHZ_EPOCH_CACHE: "   " }).epochCacheEnabled).toBe(true);
    });
  });

  describe("when an operator pulls the kill switch", () => {
    /** @scenario "The kill switch works however an operator spells it" */
    it.each(["0", "false", "off", "no", "FALSE", "False", "OFF", "No", " 0 ", "  false  "])(
      "turns the cache off for %j",
      (raw) => {
        expect(read({ AUTHZ_EPOCH_CACHE: raw }).epochCacheEnabled).toBe(false);
      },
    );
  });

  describe("when the value is none of the spellings it knows", () => {
    /** @scenario "An unrecognised setting is not read as an instruction to stop" */
    it.each(["1", "true", " yes ", "disabled", "none", "0.0", "2", "of"])(
      "fails toward the default and stays on for %j",
      (raw) => {
        expect(read({ AUTHZ_EPOCH_CACHE: raw }).epochCacheEnabled).toBe(true);
      },
    );
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
