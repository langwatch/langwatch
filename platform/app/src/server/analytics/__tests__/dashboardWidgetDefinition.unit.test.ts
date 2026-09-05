import { describe, expect, it } from "vitest";

import {
  dashboardWidgetQuerySchema,
  validateDashboardWidgetQueryParams,
} from "../dashboardWidgetDefinition";

describe("queryParameterDeclarationSchema (via dashboardWidgetQuerySchema)", () => {
  describe("given a parameter named like a reserved JavaScript property", () => {
    it.each([
      "__proto__",
      "constructor",
      "prototype",
    ])("refuses the declaration for %s", (name) => {
      const result = dashboardWidgetQuerySchema.safeParse({
        name: "q",
        sql: "select 1",
        parameters: [{ name, type: "string" }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("given an ordinary parameter name", () => {
    it("accepts the declaration", () => {
      const result = dashboardWidgetQuerySchema.safeParse({
        name: "q",
        sql: "select 1",
        parameters: [{ name: "user_id", type: "string" }],
      });

      expect(result.success).toBe(true);
    });
  });
});

describe("validateDashboardWidgetQueryParams", () => {
  describe("when a value has the declared type but exceeds its bound", () => {
    it("refuses an over-long string rather than binding it verbatim", () => {
      const result = validateDashboardWidgetQueryParams({
        query: { parameters: [{ name: "term", type: "string" }] },
        params: { term: "x".repeat(4_001) },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("dashboard_widget_query_invalid_param");
      }
    });

    it("refuses a non-finite number", () => {
      const result = validateDashboardWidgetQueryParams({
        query: { parameters: [{ name: "count", type: "number" }] },
        params: { count: Number.POSITIVE_INFINITY },
      });

      expect(result.ok).toBe(false);
    });
  });

  describe("when a value is within its declared type and bound", () => {
    it("returns it as an own property (never on the prototype)", () => {
      const result = validateDashboardWidgetQueryParams({
        query: { parameters: [{ name: "term", type: "string" }] },
        params: { term: "hello" },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.params).toEqual({ term: "hello" });
      }
    });
  });
});
