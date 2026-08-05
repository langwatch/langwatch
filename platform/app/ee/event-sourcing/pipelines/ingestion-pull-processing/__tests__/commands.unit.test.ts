import { describe, expect, it } from "vitest";

import { ConfigureIngestionPullCommand } from "../commands";

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
