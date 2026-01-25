import { describe, expect, it } from "vitest";
import {
  fieldMappings,
  getFieldMapping,
  getTableForField,
  getColumnExpression,
  requiresJoin,
  getFieldsRequiringTable,
  getTableAlias,
  buildJoinClause,
  qualifiedColumn,
  tableAliases,
} from "../field-mappings";

describe("field-mappings", () => {
  describe("fieldMappings", () => {
    it("should have mappings for trace identity fields", () => {
      expect(fieldMappings["trace_id"]).toBeDefined();
      expect(fieldMappings["trace_id"]?.table).toBe("trace_summaries");
      expect(fieldMappings["trace_id"]?.column).toBe("TraceId");

      expect(fieldMappings["project_id"]).toBeDefined();
      expect(fieldMappings["project_id"]?.column).toBe("TenantId");
    });

    it("should have mappings for metadata fields", () => {
      expect(fieldMappings["metadata.user_id"]).toBeDefined();
      expect(fieldMappings["metadata.user_id"]?.column).toBe(
        "Attributes['langwatch.user_id']"
      );
      expect(fieldMappings["metadata.user_id"]?.mapValueType).toBe("string");

      expect(fieldMappings["metadata.labels"]).toBeDefined();
      expect(fieldMappings["metadata.labels"]?.mapValueType).toBe("json_array");
    });

    it("should have mappings for performance metrics", () => {
      expect(fieldMappings["metrics.total_time_ms"]).toBeDefined();
      expect(fieldMappings["metrics.total_time_ms"]?.column).toBe(
        "TotalDurationMs"
      );

      expect(fieldMappings["metrics.total_cost"]).toBeDefined();
      expect(fieldMappings["metrics.total_cost"]?.column).toBe("TotalCost");
    });

    it("should have mappings for span fields with stored_spans table", () => {
      expect(fieldMappings["spans.span_id"]).toBeDefined();
      expect(fieldMappings["spans.span_id"]?.table).toBe("stored_spans");
      expect(fieldMappings["spans.span_id"]?.column).toBe("SpanId");

      expect(fieldMappings["spans.model"]).toBeDefined();
      expect(fieldMappings["spans.model"]?.table).toBe("stored_spans");
      expect(fieldMappings["spans.model"]?.column).toBe(
        "SpanAttributes['gen_ai.request.model']"
      );
    });

    it("should have mappings for evaluation fields with evaluation_states table", () => {
      expect(fieldMappings["evaluations.evaluator_id"]).toBeDefined();
      expect(fieldMappings["evaluations.evaluator_id"]?.table).toBe(
        "evaluation_states"
      );
      expect(fieldMappings["evaluations.evaluator_id"]?.column).toBe(
        "EvaluatorId"
      );

      expect(fieldMappings["evaluations.score"]).toBeDefined();
      expect(fieldMappings["evaluations.score"]?.column).toBe("Score");
    });

    it("should have mappings for event fields", () => {
      expect(fieldMappings["events.event_type"]).toBeDefined();
      expect(fieldMappings["events.event_type"]?.table).toBe("stored_spans");
      expect(fieldMappings["events.event_type"]?.isArray).toBe(true);
    });
  });

  describe("getFieldMapping", () => {
    it("should return mapping for known fields", () => {
      const mapping = getFieldMapping("trace_id");
      expect(mapping).toBeDefined();
      expect(mapping?.table).toBe("trace_summaries");
      expect(mapping?.column).toBe("TraceId");
    });

    it("should return undefined for unknown fields", () => {
      const mapping = getFieldMapping("unknown.field");
      expect(mapping).toBeUndefined();
    });
  });

  describe("getTableForField", () => {
    it("should return trace_summaries for trace fields", () => {
      expect(getTableForField("trace_id")).toBe("trace_summaries");
      expect(getTableForField("metrics.total_cost")).toBe("trace_summaries");
    });

    it("should return stored_spans for span fields", () => {
      expect(getTableForField("spans.span_id")).toBe("stored_spans");
      expect(getTableForField("spans.model")).toBe("stored_spans");
    });

    it("should return evaluation_states for evaluation fields", () => {
      expect(getTableForField("evaluations.evaluator_id")).toBe(
        "evaluation_states"
      );
      expect(getTableForField("evaluations.score")).toBe("evaluation_states");
    });

    it("should return trace_summaries as default for unknown fields", () => {
      expect(getTableForField("unknown.field")).toBe("trace_summaries");
    });
  });

  describe("getColumnExpression", () => {
    it("should return column expression for known fields", () => {
      expect(getColumnExpression("trace_id")).toBe("TraceId");
      expect(getColumnExpression("metrics.total_cost")).toBe("TotalCost");
    });

    it("should return map access expression for metadata fields", () => {
      expect(getColumnExpression("metadata.user_id")).toBe(
        "Attributes['langwatch.user_id']"
      );
    });

    it("should return fallback for unknown fields", () => {
      expect(getColumnExpression("unknown.field")).toBe("unknown_field");
    });
  });

  describe("requiresJoin", () => {
    it("should return null for trace_summaries fields", () => {
      expect(requiresJoin("trace_id")).toBeNull();
      expect(requiresJoin("metrics.total_cost")).toBeNull();
    });

    it("should return stored_spans for span fields", () => {
      expect(requiresJoin("spans.span_id")).toBe("stored_spans");
      expect(requiresJoin("spans.model")).toBe("stored_spans");
    });

    it("should return evaluation_states for evaluation fields", () => {
      expect(requiresJoin("evaluations.evaluator_id")).toBe("evaluation_states");
    });
  });

  describe("getFieldsRequiringTable", () => {
    it("should return fields for stored_spans table", () => {
      const fields = getFieldsRequiringTable("stored_spans");
      expect(fields).toContain("spans.span_id");
      expect(fields).toContain("spans.model");
      expect(fields).toContain("events.event_type");
    });

    it("should return fields for evaluation_states table", () => {
      const fields = getFieldsRequiringTable("evaluation_states");
      expect(fields).toContain("evaluations.evaluator_id");
      expect(fields).toContain("evaluations.score");
      expect(fields).toContain("evaluations.passed");
    });
  });

  describe("tableAliases", () => {
    it("should have correct aliases for all tables", () => {
      expect(tableAliases.trace_summaries).toBe("ts");
      expect(tableAliases.stored_spans).toBe("ss");
      expect(tableAliases.evaluation_states).toBe("es");
    });
  });

  describe("getTableAlias", () => {
    it("should return correct alias for each table", () => {
      expect(getTableAlias("trace_summaries")).toBe("ts");
      expect(getTableAlias("stored_spans")).toBe("ss");
      expect(getTableAlias("evaluation_states")).toBe("es");
    });
  });

  describe("buildJoinClause", () => {
    it("should return empty string for trace_summaries", () => {
      expect(buildJoinClause("trace_summaries")).toBe("");
    });

    it("should build correct JOIN for stored_spans", () => {
      const join = buildJoinClause("stored_spans");
      expect(join).toContain("JOIN stored_spans ss FINAL");
      expect(join).toContain("ts.TenantId = ss.TenantId");
      expect(join).toContain("ts.TraceId = ss.TraceId");
    });

    it("should build correct JOIN for evaluation_states", () => {
      const join = buildJoinClause("evaluation_states");
      expect(join).toContain("JOIN evaluation_states es FINAL");
      expect(join).toContain("ts.TenantId = es.TenantId");
      expect(join).toContain("ts.TraceId = es.TraceId");
    });
  });

  describe("qualifiedColumn", () => {
    it("should prefix simple columns with table alias", () => {
      expect(qualifiedColumn("trace_id")).toBe("ts.TraceId");
      expect(qualifiedColumn("spans.span_id")).toBe("ss.SpanId");
      expect(qualifiedColumn("evaluations.evaluator_id")).toBe("es.EvaluatorId");
    });

    it("should handle map access columns correctly", () => {
      const result = qualifiedColumn("metadata.user_id");
      expect(result).toContain("ts.Attributes");
      expect(result).toContain("langwatch.user_id");
    });

    it("should return field as-is for unknown fields", () => {
      expect(qualifiedColumn("unknown.field")).toBe("unknown.field");
    });
  });
});
