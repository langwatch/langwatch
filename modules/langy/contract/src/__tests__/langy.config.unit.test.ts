import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertLangyServerConfig, langyConfig } from "../langy.config.ts";

function resolve(source: Record<string, string>) {
  return parseProcessConfig({
    owners: [{ name: "langy", config: langyConfig }],
    environment: source,
  }).langy;
}

describe("langy server configuration", () => {
  describe("given a deployment runs no agent manager", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts an absent leaf", () => {
      expect(resolve({})).toEqual({ agentUrl: undefined });
    });
  });

  describe("when assertLangyServerConfig checks the resolved secret", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts both leaves absent", () => {
      expect(() => assertLangyServerConfig(resolve({}), undefined)).not.toThrow();
    });

    it("accepts a secret whose manager is not running", () => {
      expect(() => assertLangyServerConfig(resolve({}), "s3cret")).not.toThrow();
    });

    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses the configuration and names both variables", () => {
      const config = resolve({ LANGY_AGENT_URL: "http://127.0.0.1:5564" });
      expect(() => assertLangyServerConfig(config, undefined)).toThrow(
        /LANGY_AGENT_URL is set, LANGY_INTERNAL_SECRET is not/,
      );
    });

    it("accepts a fully configured agent manager", () => {
      const config = resolve({ LANGY_AGENT_URL: "http://127.0.0.1:5564" });
      expect(() => assertLangyServerConfig(config, "s3cret")).not.toThrow();
    });
  });
});
