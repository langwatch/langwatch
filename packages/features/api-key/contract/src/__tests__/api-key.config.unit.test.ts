import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { apiKeyServerConfigDefinition } from "../api-key.config.ts";

describe("api key server configuration", () => {
  describe("given a deployment sets no pepper", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots without one rather than refusing", () => {
      expect(
        RuntimeConfig.create({
          name: "api-key",
          definition: apiKeyServerConfigDefinition,
          source: {},
        }).value.pepper,
      ).toBeUndefined();
    });
  });

  describe("given a deployment sets a pepper", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it verbatim, never the decoded bytes", () => {
      expect(
        RuntimeConfig.create({
          name: "api-key",
          definition: apiKeyServerConfigDefinition,
          source: { API_KEY_PEPPER: " padded " },
        }).value.pepper,
      ).toBe(" padded ");
    });
  });
});
