import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { storedObjectConfig } from "../stored-object.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "stored-object", config: storedObjectConfig }],
    environment,
  })["stored-object"];

describe("stored object server configuration", () => {
  describe("given the spool retention confirmation is absent", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the confirmation as withheld", () => {
      expect(read({}).azureSpoolRetentionConfirmed).toBe(false);
    });
  });
});
