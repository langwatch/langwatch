import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { langyServerConfigDefinition } from "../langy.config.ts";

function resolve(source: Record<string, string>) {
  return RuntimeConfig.create({ name: "langy", definition: langyServerConfigDefinition, source })
    .value;
}

describe("langy server configuration", () => {
  describe("given a deployment runs no agent manager", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts both leaves absent", () => {
      expect(resolve({})).toEqual({ agentUrl: undefined, internalSecret: undefined });
    });

    it("accepts a secret whose manager is not running", () => {
      expect(resolve({ LANGY_INTERNAL_SECRET: "s3cret" }).agentUrl).toBeUndefined();
    });
  });

  describe("given a deployment names an address but no secret", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses the configuration in the schema and names both variables", () => {
      expect(() => resolve({ LANGY_AGENT_URL: "http://127.0.0.1:5564" })).toThrow(
        /internalSecret \(LANGY_INTERNAL_SECRET, custom\): .*LANGY_AGENT_URL is set, LANGY_INTERNAL_SECRET is not/,
      );
    });
  });
});
