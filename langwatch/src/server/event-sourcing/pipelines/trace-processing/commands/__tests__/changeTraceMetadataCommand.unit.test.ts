import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTenantId, type Command } from "../../../../";
import {
  CHANGE_TRACE_METADATA_COMMAND_TYPE,
  TRACE_METADATA_CHANGED_EVENT_TYPE,
} from "../../schemas/constants";
import { traceMetadataChangedEventDataSchema } from "../../schemas/events";
import { ChangeTraceMetadataCommand } from "../changeTraceMetadataCommand";

type CommandData = {
  traceId: string;
  metadata: Record<string, unknown>;
  changedByUserId: string | null;
  tenantId: string;
  occurredAt: number;
};

function makeCommand(
  overrides: Partial<CommandData> = {},
): Command<CommandData> {
  const data: CommandData = {
    tenantId: "project-1",
    traceId: "trace-abc",
    metadata: { user_id: "new-user", labels: ["qa"] },
    changedByUserId: "user-123",
    occurredAt: Date.now(),
    ...overrides,
  };
  return {
    type: CHANGE_TRACE_METADATA_COMMAND_TYPE,
    aggregateId: data.traceId,
    tenantId: createTenantId(data.tenantId),
    data,
  };
}

describe("ChangeTraceMetadataCommand", () => {
  describe("when the command is dispatched with valid metadata", () => {
    /** @scenario ChangeTraceMetadataCommand produces a TraceMetadataChangedEvent */
    it("produces a TraceMetadataChangedEvent with correct data", () => {
      const handler = new ChangeTraceMetadataCommand();
      const command = makeCommand({
        traceId: "trace-abc",
        metadata: { user_id: "new-user", labels: ["qa"] },
        changedByUserId: "user-123",
      });

      const events = handler.handle(command);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe(TRACE_METADATA_CHANGED_EVENT_TYPE);
      expect(event.data).toMatchObject({
        traceId: "trace-abc",
        metadata: { user_id: "new-user", labels: ["qa"] },
        changedByUserId: "user-123",
      });
      expect(event.aggregateId).toBe("trace-abc");
    });
  });

  describe("when dispatched with an empty metadata object", () => {
    /** @scenario Command rejects empty metadata object */
    it("fails schema validation", () => {
      const result = traceMetadataChangedEventDataSchema.safeParse({
        traceId: "trace-abc",
        metadata: {},
        changedByUserId: "user-123",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("when dispatched with an oversized metadata value", () => {
    /** @scenario Command rejects oversized metadata values */
    it("fails schema validation for values exceeding 4KB", () => {
      const result = traceMetadataChangedEventDataSchema.safeParse({
        traceId: "trace-abc",
        metadata: { big_value: "x".repeat(4097) },
        changedByUserId: "user-123",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("when the same metadata payload is dispatched twice", () => {
    /** @scenario Command deduplicates identical metadata submissions */
    it("produces the same idempotency key", () => {
      const metadata = { user_id: "same-user", labels: ["qa"] };
      const data = {
        tenantId: "project-1",
        traceId: "trace-abc",
        metadata,
        changedByUserId: "user-123",
        occurredAt: 1000,
      };

      const handler = new ChangeTraceMetadataCommand();
      const cmd1 = makeCommand(data);
      const cmd2 = makeCommand(data);

      const events1 = handler.handle(cmd1);
      const events2 = handler.handle(cmd2);

      expect(events1[0]!.idempotencyKey).toBe(events2[0]!.idempotencyKey);
    });

    it("produces the same idempotency key regardless of object key order", () => {
      const handler = new ChangeTraceMetadataCommand();

      const cmd1 = makeCommand({
        metadata: { user_id: "u1", labels: ["qa"] },
      });
      const cmd2 = makeCommand({
        metadata: { labels: ["qa"], user_id: "u1" },
      });

      const events1 = handler.handle(cmd1);
      const events2 = handler.handle(cmd2);

      expect(events1[0]!.idempotencyKey).toBe(events2[0]!.idempotencyKey);
    });
  });

  describe("when two partial updates arrive with different timestamps", () => {
    /** @scenario Rapid partial updates are not coalesced */
    it("produces distinct makeJobIds", () => {
      const data1 = {
        tenantId: "project-1",
        traceId: "trace-abc",
        metadata: { user_id: "a" },
        changedByUserId: "user-123",
        occurredAt: 1000,
      };
      const data2 = {
        tenantId: "project-1",
        traceId: "trace-abc",
        metadata: { labels: ["x"] },
        changedByUserId: "user-123",
        occurredAt: 1200,
      };

      const jobId1 = ChangeTraceMetadataCommand.makeJobId!(data1);
      const jobId2 = ChangeTraceMetadataCommand.makeJobId!(data2);

      expect(jobId1).not.toBe(jobId2);
    });
  });

  describe("when checking API documentation", () => {
    /** @scenario API documentation includes the changeMetadata endpoint */
    it("has the update-metadata docs file", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const docsPath = path.resolve(
        __dirname,
        "../../../../../../../..",
        "docs/api-reference/traces/update-metadata.mdx",
      );
      expect(fs.existsSync(docsPath)).toBe(true);

      const content = fs.readFileSync(docsPath, "utf-8");
      expect(content).toContain("Update trace metadata");
      expect(content).toContain("PATCH");
      expect(content).toContain("metadata");
      expect(content).toContain("labels");
    });
  });
});
