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
});
