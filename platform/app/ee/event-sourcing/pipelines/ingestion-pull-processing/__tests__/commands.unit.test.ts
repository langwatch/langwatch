import { describe, expect, it } from "vitest";

import {
  ConfigureIngestionPullCommand,
  RecordIngestionPullAgentsListedCommand,
  RecordIngestionPullAgentsListingRefusedCommand,
  RecordIngestionPullRunCompletedCommand,
  RequestIngestionPullAgentsListingCommand,
} from "../commands";

const baseData = {
  tenantId: "gov-project",
  occurredAt: Date.parse("2026-07-17T10:00:00Z"),
  sourceId: "source-1",
  configVersion: "v1",
  cursor: null,
};

describe("ConfigureIngestionPullCommand", () => {
  describe("when the pull schedule is not a five-field cron", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "not a cron",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule has five fields croner cannot evaluate", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "99 99 99 99 99",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule is a valid cron", () => {
    it("accepts the command", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "*/15 * * * *",
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("RecordIngestionPullRunCompletedCommand", () => {
  const completion = {
    tenantId: "gov-project",
    occurredAt: Date.parse("2026-08-31T10:00:00Z"),
    sourceId: "source-1",
    runId: "run-1",
    scheduledFor: Date.parse("2026-08-31T09:45:00Z"),
    nextCursor: "cursor-2",
    eventCount: 3,
  };

  describe("when the run reported errors alongside its progress", () => {
    it("carries the error count through to the event", () => {
      const result = RecordIngestionPullRunCompletedCommand.schema.validate({
        ...completion,
        errorCount: 2,
      });

      expect(result.success).toBe(true);
      // A stripped field would be indistinguishable from a clean run by the
      // time the fold reads it, which is exactly the laundering this closes.
      expect(result.data).toMatchObject({ errorCount: 2 });
    });
  });

  describe("when the run reported no error count at all", () => {
    it("still validates, because every completion already on the log omits it", () => {
      const result =
        RecordIngestionPullRunCompletedCommand.schema.validate(completion);

      expect(result.success).toBe(true);
      expect(result.data).not.toHaveProperty("errorCount");
    });
  });
});

describe("agent listing commands", () => {
  const envelope = {
    tenantId: "gov-project",
    occurredAt: Date.parse("2026-09-09T10:00:00Z"),
    sourceId: "source-1",
    requestId: "req-1",
    requestedAt: Date.parse("2026-09-09T09:59:00Z"),
  };

  /** Runs the command the way the runtime does, and returns its one event. */
  const emit = (
    command: { new (): { handle(c: unknown): { [k: string]: unknown }[] } },
    data: Record<string, unknown>,
  ) =>
    new command().handle({
      tenantId: "gov-project",
      data,
    })[0];

  describe("the request that starts a listing", () => {
    it("commits to the pull aggregate, so one source is one ordered stream", () => {
      const event = emit(RequestIngestionPullAgentsListingCommand, {
        ...envelope,
      });

      expect(event.aggregateType).toBe("ingestion_pull");
      expect(event.aggregateId).toBe("source-1");
    });

    it("settles a redelivery of one press onto the same event", () => {
      const key = (requestId: string) =>
        emit(RequestIngestionPullAgentsListingCommand, {
          ...envelope,
          requestId,
        }).idempotencyKey;

      expect(key("req-1")).toBe(key("req-1"));
      expect(key("req-1")).not.toBe(key("req-2"));
    });
  });

  describe("the two outcomes", () => {
    it("cannot collide with each other", () => {
      const listed = emit(RecordIngestionPullAgentsListedCommand, {
        ...envelope,
        agentCount: 0,
      }).idempotencyKey;
      const refused = emit(RecordIngestionPullAgentsListingRefusedCommand, {
        ...envelope,
        reason: "unauthorized",
        status: 403,
      }).idempotencyKey;

      expect(listed).not.toBe(refused);
      expect(listed).toContain("req-1");
      expect(refused).toContain("req-1");
    });

    it("accepts a zero count, because an empty answer is still an answer", () => {
      const result = RecordIngestionPullAgentsListedCommand.schema.validate({
        ...envelope,
        agentCount: 0,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ agentCount: 0 });
    });

    it("refuses a listing with no reason at all", () => {
      const result =
        RecordIngestionPullAgentsListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "",
          status: null,
        });

      expect(result.success).toBe(false);
    });

    it("accepts a refusal that came without an HTTP status", () => {
      const result =
        RecordIngestionPullAgentsListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "unreachable",
          status: null,
        });

      expect(result.success).toBe(true);
    });
  });
});
