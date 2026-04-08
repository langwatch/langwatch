import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  commandEnvelopeSchema,
  withCommandEnvelope,
  stripEnvelope,
} from "../commandEnvelope";

describe("commandEnvelope", () => {
  describe("commandEnvelopeSchema", () => {
    it("validates tenantId, occurredAt, and optional idempotencyKey", () => {
      const result = commandEnvelopeSchema.safeParse({
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
      });
      expect(result.success).toBe(true);
    });

    it("accepts idempotencyKey when provided", () => {
      const result = commandEnvelopeSchema.safeParse({
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
        idempotencyKey: "key-123",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.idempotencyKey).toBe("key-123");
      }
    });

    it("rejects missing tenantId", () => {
      const result = commandEnvelopeSchema.safeParse({
        occurredAt: 1700000000000,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing occurredAt", () => {
      const result = commandEnvelopeSchema.safeParse({
        tenantId: "tenant-1",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("withCommandEnvelope()", () => {
    it("merges envelope fields into an event data schema", () => {
      const eventDataSchema = z.object({
        batchRunId: z.string(),
        total: z.number(),
      });

      const commandSchema = withCommandEnvelope(eventDataSchema);
      const result = commandSchema.safeParse({
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
        batchRunId: "batch-123",
        total: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          tenantId: "tenant-1",
          occurredAt: 1700000000000,
          batchRunId: "batch-123",
          total: 5,
        });
      }
    });

    it("includes optional idempotencyKey in merged schema", () => {
      const eventDataSchema = z.object({ id: z.string() });
      const commandSchema = withCommandEnvelope(eventDataSchema);

      const result = commandSchema.safeParse({
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
        idempotencyKey: "idem-1",
        id: "item-1",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.idempotencyKey).toBe("idem-1");
      }
    });
  });

  describe("stripEnvelope()", () => {
    it("removes tenantId, occurredAt, and idempotencyKey from data", () => {
      const data = {
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
        idempotencyKey: "key-123",
        batchRunId: "batch-123",
        total: 5,
      };

      const eventData = stripEnvelope(data);
      expect(eventData).toEqual({
        batchRunId: "batch-123",
        total: 5,
      });
    });

    it("works when idempotencyKey is absent", () => {
      const data = {
        tenantId: "tenant-1",
        occurredAt: 1700000000000,
        scenarioRunId: "sr-1",
      };

      const eventData = stripEnvelope(data);
      expect(eventData).toEqual({ scenarioRunId: "sr-1" });
    });
  });
});
