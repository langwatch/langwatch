import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { secretServerConfigDefinition } from "../secret.config.ts";

describe("secret server configuration", () => {
  describe("given a deployment stores no credentials", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no cipher key rather than refusing", () => {
      expect(
        RuntimeConfig.create({
          name: "secret",
          definition: secretServerConfigDefinition,
          source: {},
        }).value.encryptionKey,
      ).toBeUndefined();
    });
  });

  describe("given a deployment sets a cipher key", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries it as written, leaving its shape to the cipher", () => {
      expect(
        RuntimeConfig.create({
          name: "secret",
          definition: secretServerConfigDefinition,
          source: { CREDENTIALS_SECRET: "not-base64" },
        }).value.encryptionKey,
      ).toBe("not-base64");
    });
  });
});
