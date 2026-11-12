import { describe, expect, it } from "vitest";

import { scenarioTrpcCreateSchema, scenarioTrpcUpdateSchema } from "../scenario.trpc.ts";

describe("the scenarios tRPC inputs", () => {
  describe("when a scenario is created with suite field values", () => {
    it("keeps the values for the save", () => {
      const parsed = scenarioTrpcCreateSchema.parse({
        projectId: "project-a",
        name: "Checkout",
        situation: "A customer checks out",
        fields: { golden_sql: "SELECT 1" },
      });

      expect(parsed.fields).toEqual({ golden_sql: "SELECT 1" });
    });
  });

  describe("when a scenario is updated with suite field values", () => {
    it("keeps the values for the save", () => {
      const parsed = scenarioTrpcUpdateSchema.parse({
        projectId: "project-a",
        id: "scenario-a",
        fields: { max_rows: 12 },
      });

      expect(parsed.fields).toEqual({ max_rows: 12 });
    });
  });

  describe("when a scenario is saved with a judge trace wait", () => {
    it("keeps both settings for the create and the update", () => {
      const created = scenarioTrpcCreateSchema.parse({
        projectId: "project-a",
        name: "Checkout",
        situation: "A customer checks out",
        traceQuietPeriodMs: 12_000,
        traceWaitTimeoutMs: 90_000,
      });
      const updated = scenarioTrpcUpdateSchema.parse({
        projectId: "project-a",
        id: "scenario-a",
        traceQuietPeriodMs: null,
        traceWaitTimeoutMs: 45_000,
      });

      expect(created).toMatchObject({ traceQuietPeriodMs: 12_000, traceWaitTimeoutMs: 90_000 });
      expect(updated).toMatchObject({ traceQuietPeriodMs: null, traceWaitTimeoutMs: 45_000 });
    });

    /** @scenario "Trace wait settings outside their bounds are refused" */
    it("refuses a quiet period above a minute", () => {
      const parsed = scenarioTrpcUpdateSchema.safeParse({
        projectId: "p",
        id: "s",
        traceQuietPeriodMs: 61_000,
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(["traceQuietPeriodMs"]);
    });
  });
});
