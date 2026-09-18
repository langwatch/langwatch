import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { platformHealthServerConfigDefinition } from "../platform-health.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({
    name: "platform-health",
    definition: platformHealthServerConfigDefinition,
    source,
  }).value;

describe("given a deployment that configured the platform health surface", () => {
  describe("when its configuration is read", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads only its deployment fact, never a credential", () => {
      expect(read({ BASE_HOST: "https://example.com" })).toEqual({
        publicBaseUrl: "https://example.com",
      });
    });
  });
});
