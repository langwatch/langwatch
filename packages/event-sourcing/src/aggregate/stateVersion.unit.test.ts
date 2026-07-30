import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import { deriveStateVersion, resolveStateVersion } from "./stateVersion";

/**
 * The whole point of a derived version is that it cannot be forgotten (ADR-105
 * §4): a shape change moves the hash without anyone writing a bump. These
 * tests are about that property from both sides — things that must NOT move
 * the hash (key order, descriptions) and things that MUST (a type change, an
 * optionality change) — plus the failure modes that would silently defeat it:
 * an unhandled node type falling through, and a pin absorbing drift instead
 * of just renaming it.
 */

describe("deriveStateVersion", () => {
  describe("given two schemas that differ only in presentation", () => {
    it("hashes the same regardless of key order", () => {
      const a = z.object({ id: z.string(), count: z.number() });
      const b = z.object({ count: z.number(), id: z.string() });
      expect(deriveStateVersion(a)).toBe(deriveStateVersion(b));
    });

    it("hashes the same with and without a description", () => {
      const plain = z.object({ id: z.string() });
      const described = z
        .object({ id: z.string().describe("the primary key") })
        .describe("a described schema");
      expect(deriveStateVersion(plain)).toBe(deriveStateVersion(described));
    });
  });

  describe("given two schemas that differ structurally", () => {
    it("hashes differently when a field's type changes", () => {
      const before = z.object({ value: z.string() });
      const after = z.object({ value: z.number() });
      expect(deriveStateVersion(before)).not.toBe(deriveStateVersion(after));
    });

    it("hashes differently between optional and required", () => {
      const required = z.object({ value: z.string() });
      const optional = z.object({ value: z.string().optional() });
      expect(deriveStateVersion(required)).not.toBe(
        deriveStateVersion(optional),
      );
    });

    it("hashes differently for nested objects with different shapes", () => {
      const before = z.object({
        inner: z.object({ a: z.string() }),
      });
      const after = z.object({
        inner: z.object({ a: z.string(), b: z.number() }),
      });
      expect(deriveStateVersion(before)).not.toBe(deriveStateVersion(after));
    });

    it("hashes differently for arrays of objects with different shapes", () => {
      const before = z.object({
        items: z.array(z.object({ id: z.string() })),
      });
      const after = z.object({
        items: z.array(z.object({ id: z.string(), label: z.string() })),
      });
      expect(deriveStateVersion(before)).not.toBe(deriveStateVersion(after));
    });
  });

  describe("given a recursive schema", () => {
    it("terminates instead of recursing forever", () => {
      interface TreeNode {
        readonly label: string;
        readonly children: readonly TreeNode[];
      }
      const treeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          label: z.string(),
          children: z.array(treeSchema),
        }),
      );
      expect(() => deriveStateVersion(treeSchema)).not.toThrow();
      // Deterministic, not just non-throwing — the same recursive shape
      // hashes the same way every time it is derived.
      expect(deriveStateVersion(treeSchema)).toBe(
        deriveStateVersion(treeSchema),
      );
    });
  });

  describe("given a schema this module does not handle", () => {
    it("throws a ConfigurationError naming the unhandled type", () => {
      const unhandled = z.object({ fn: z.function() });
      expect(() => deriveStateVersion(unhandled)).toThrow(ConfigurationError);
      try {
        deriveStateVersion(unhandled);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        const configError = error as ConfigurationError;
        expect(configError.message).toContain("ZodFunction");
        expect(configError.context.typeName).toBe("ZodFunction");
      }
    });
  });
});

describe("resolveStateVersion", () => {
  describe("given no pin", () => {
    it("uses the derived hash as the version", () => {
      const schema = z.object({ id: z.string() });
      const resolved = resolveStateVersion({ schema });
      expect(resolved.version).toBe(resolved.schemaHash);
      expect(resolved.version).toBe(deriveStateVersion(schema));
    });
  });

  describe("given a pin", () => {
    it("reports the pin as the version but still reports the real hash", () => {
      const schema = z.object({ id: z.string() });
      const resolved = resolveStateVersion({ schema, pinned: "3" });
      expect(resolved.version).toBe("3");
      expect(resolved.schemaHash).toBe(deriveStateVersion(schema));
      expect(resolved.schemaHash).not.toBe("3");
    });

    it("moves the reported hash when the pinned schema's shape drifts", () => {
      const before = resolveStateVersion({
        schema: z.object({ id: z.string() }),
        pinned: "3",
      });
      const after = resolveStateVersion({
        schema: z.object({ id: z.string(), extra: z.number() }),
        pinned: "3",
      });
      // The pin hides the drift from the version a row is stamped with, but
      // schemaHash is exactly the signal that would let an operator notice a
      // pin has gone stale.
      expect(before.version).toBe(after.version);
      expect(before.schemaHash).not.toBe(after.schemaHash);
    });
  });
});
