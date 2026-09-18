import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { apiKeyServerConfig } from "../api-key.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "api-key", config: apiKeyServerConfig }], environment })[
    "api-key"
  ];

describe("api key server configuration", () => {
  describe("given a deployment sets no pepper", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots without one rather than refusing", () => {
      expect(read({}).pepper).toBeUndefined();
    });
  });

  describe("given a deployment sets a pepper", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it verbatim, never the decoded bytes", () => {
      expect(read({ API_KEY_PEPPER: " padded " }).pepper).toBe(" padded ");
    });
  });
});
