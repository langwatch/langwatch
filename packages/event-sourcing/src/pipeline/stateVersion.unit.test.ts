import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import { deriveStateVersion, resolveStateVersion } from "./stateVersion";

/**
 * A fold's version stamp exists so a stale row can never decode into the
 * current shape's meaning, which only holds if the hash actually moves when
 * the shape does and stays put when nothing about the shape changed.
 */
describe("deriveStateVersion", () => {
  describe("given two schemas with the identical shape", () => {
    it("hashes identically regardless of declared key order", () => {
      const a = z.object({ total: z.number(), status: z.string() });
      const b = z.object({ status: z.string(), total: z.number() });
      expect(deriveStateVersion(a)).toBe(deriveStateVersion(b));
    });

    it("hashes identically whether or not a field carries a description", () => {
      const a = z.object({ total: z.number() });
      const b = z.object({ total: z.number().describe("running total") });
      expect(deriveStateVersion(a)).toBe(deriveStateVersion(b));
    });
  });

  describe("given a schema whose shape changes", () => {
    it("changes the hash when a field's type changes", () => {
      const a = z.object({ total: z.number() });
      const b = z.object({ total: z.string() });
      expect(deriveStateVersion(a)).not.toBe(deriveStateVersion(b));
    });

    it("changes the hash when a field is added", () => {
      const a = z.object({ total: z.number() });
      const b = z.object({ total: z.number(), failed: z.number() });
      expect(deriveStateVersion(a)).not.toBe(deriveStateVersion(b));
    });

    it("changes the hash when a field becomes optional", () => {
      const a = z.object({ total: z.number() });
      const b = z.object({ total: z.number().optional() });
      expect(deriveStateVersion(a)).not.toBe(deriveStateVersion(b));
    });
  });

  describe("given nested and composite shapes", () => {
    it("hashes an array, a union and a nested object without throwing", () => {
      const schema = z.object({
        tags: z.array(z.string()),
        status: z.union([z.literal("open"), z.literal("closed")]),
        meta: z.object({ owner: z.string() }),
      });
      expect(deriveStateVersion(schema)).toMatch(/^[0-9a-f]{12}$/);
    });

    it("refuses a schema shape this module cannot walk", () => {
      // A function schema has no representable structural summary.
      expect(() => deriveStateVersion(z.function() as never)).toThrow(
        ConfigurationError,
      );
    });
  });
});

describe("resolveStateVersion", () => {
  describe("given no pin", () => {
    it("reports the derived hash as the version", () => {
      const schema = z.object({ total: z.number() });
      const { version, schemaHash } = resolveStateVersion({ schema });
      expect(version).toBe(schemaHash);
    });
  });

  describe("given an explicit pin", () => {
    it("stamps the pin as the version while still reporting the hash", () => {
      const schema = z.object({ total: z.number() });
      const { version, schemaHash } = resolveStateVersion({
        schema,
        pinned: "legacy-3",
      });
      expect(version).toBe("legacy-3");
      expect(schemaHash).not.toBe("legacy-3");
      expect(schemaHash).toBe(deriveStateVersion(schema));
    });
  });
});
