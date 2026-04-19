import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { serializeRowForAudit } from "../auditSerializer";

/**
 * The serializer exists to solve one specific bug class: default
 * JSON.stringify throws on BigInt, which would crash any audit write for a
 * Prisma model with a BigInt column. VirtualKey.revision already has that
 * shape today; new columns added tomorrow will inherit the protection.
 *
 * These tests pin the contract so a future engineer doesn't "simplify" the
 * replacer away. See virtualKey.service.unit.test.ts for the context where
 * the bug originally surfaced.
 */
describe("serializeRowForAudit", () => {
  describe("when the row contains a BigInt field", () => {
    it("coerces to a decimal string (no throw)", () => {
      const row = { id: "vk_01", revision: 1_234_567_890n };
      const out = serializeRowForAudit(row) as Record<string, unknown>;
      expect(out.revision).toBe("1234567890");
    });

    it("handles BigInt nested inside arrays and objects", () => {
      const row = {
        id: "vk_01",
        history: [{ at: new Date("2026-01-01"), revision: 5n }],
      };
      const out = serializeRowForAudit(row) as {
        history: Array<{ revision: unknown }>;
      };
      expect(out.history[0]?.revision).toBe("5");
    });
  });

  describe("when the row has no BigInt fields", () => {
    it("passes through as-is (no data loss)", () => {
      const row = {
        id: "b_01",
        name: "monthly",
        limitUsd: "100.00",
        onBreach: "BLOCK",
        archivedAt: null,
      };
      expect(serializeRowForAudit(row)).toEqual(row);
    });
  });

  describe("when the row contains a Prisma.Decimal", () => {
    it("serializes to the Decimal's toJSON shape (string) — matches Prisma wire format", () => {
      const row = {
        id: "b_01",
        limitUsd: new Prisma.Decimal("123.456789"),
      };
      const out = serializeRowForAudit(row) as Record<string, unknown>;
      expect(out.limitUsd).toBe("123.456789");
    });
  });

  describe("return value shape", () => {
    it("is a deep-copied plain-JSON object — mutating the result does not touch the source", () => {
      const row = { id: "vk_01", meta: { nested: "value" } };
      const out = serializeRowForAudit(row) as {
        meta: { nested: string };
      };
      out.meta.nested = "mutated";
      expect(row.meta.nested).toBe("value");
    });
  });
});
