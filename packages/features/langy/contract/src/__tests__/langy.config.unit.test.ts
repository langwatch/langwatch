import { describe, expect, it } from "vitest";
import { assertLangyServerConfig } from "../langy.config.ts";

describe("langy server configuration", () => {
  describe("given a deployment runs no agent manager", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts both leaves absent", () => {
      expect(() =>
        assertLangyServerConfig({ agentUrl: undefined, internalSecret: undefined }),
      ).not.toThrow();
    });
  });

  describe("given a deployment names an address but no secret", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses the configuration and names both variables", () => {
      expect(() =>
        assertLangyServerConfig({
          agentUrl: "http://127.0.0.1:5564",
          internalSecret: undefined,
        }),
      ).toThrow(/LANGY_AGENT_URL and LANGY_INTERNAL_SECRET/);
    });
  });
});
