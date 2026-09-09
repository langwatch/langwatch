import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { licensingServerConfigDefinition } from "../licensing.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "licensing", definition: licensingServerConfigDefinition, source })
    .value;

describe("licensing server configuration", () => {
  describe("given a deployment rotated the public key", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the rotated key", () => {
      expect(read({ LANGWATCH_LICENSE_PUBLIC_KEY: "rotated-key" }).publicKey).toBe("rotated-key");
    });
  });

  describe("given the key is exported blank", () => {
    /** @scenario "A blank identifier resolves to absent rather than to an empty filter" */
    it("falls back to the embedded key rather than refusing every licence", () => {
      expect(read({ LANGWATCH_LICENSE_PUBLIC_KEY: "  " }).publicKey).toBeUndefined();
      expect(read({}).publicKey).toBeUndefined();
    });
  });
});
