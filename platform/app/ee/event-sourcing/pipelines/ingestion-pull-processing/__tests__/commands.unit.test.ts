import { describe, expect, it } from "vitest";

import {
  ConfigureIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
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
