import { describe, expect, it } from "vitest";

import { ingestionPullConfiguredCommandDataSchema } from "../schemas/events";

const baseData = {
  occurredAt: Date.parse("2026-07-17T10:00:00Z"),
  sourceId: "source-1",
  configVersion: "v1",
  cursor: null,
};

describe("the configure command's input", () => {
  describe("when the pull schedule is not a five-field cron", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ingestionPullConfiguredCommandDataSchema.safeParse({
        ...baseData,
        cron: "not a cron",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule has five fields croner cannot evaluate", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ingestionPullConfiguredCommandDataSchema.safeParse({
        ...baseData,
        cron: "99 99 99 99 99",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule is a valid cron", () => {
    it("accepts the command", () => {
      const result = ingestionPullConfiguredCommandDataSchema.safeParse({
        ...baseData,
        cron: "*/15 * * * *",
      });
      expect(result.success).toBe(true);
    });
  });
});
