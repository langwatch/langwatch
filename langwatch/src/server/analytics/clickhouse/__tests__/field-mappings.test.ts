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
    it("has mappings for trace identity fields", () => {
      expect(fieldMappings["trace_id"]).toBeDefined();
      expect(fieldMappings["trace_id"]?.table).toBe("trace_summaries");
      expect(fieldMappings["trace_id"]?.column).toBe("TraceId");

      expect(fieldMappings["project_id"]).toBeDefined();
      expect(fieldMappings["project_id"]?.column).toBe("TenantId");
    });

    it("has mappings for metadata fields", () => {
      expect(fieldMappings["metadata.user_id"]).toBeDefined();
      expect(fieldMappings["metadata.user_id"]?.column).toBe(
        "Attributes['langwatch.user_id']"
      );
      expect(fieldMappings["metadata.user_id"]?.mapValueType).toBe("string");

      expect(fieldMappings["metadata.labels"]).toBeDefined();
      expect(fieldMappings["metadata.labels"]?.mapValueType).toBe("json_array");
    });

    it("has mappings for performance metrics", () => {
      expect(fieldMappings["metrics.total_time_ms"]).toBeDefined();
      expect(fieldMappings["metrics.total_time_ms"]?.column).toBe(
        "TotalDurationMs"
      );

      expect(fieldMappings["metrics.total_cost"]).toBeDefined();
      expect(fieldMappings["metrics.total_cost"]?.column).toBe("TotalCost");
    });

    it("has mappings for span fields with stored_spans table", () => {
      expect(fieldMappings["spans.span_id"]).toBeDefined();
      expect(fieldMappings["spans.span_id"]?.table).toBe("stored_spans");
      expect(fieldMappings["spans.span_id"]?.column).toBe("SpanId");

      expect(fieldMappings["spans.model"]).toBeDefined();
      expect(fieldMappings["spans.model"]?.table).toBe("stored_spans");
      expect(fieldMappings["spans.model"]?.column).toBe(
        "SpanAttributes['gen_ai.request.model']"
      );
    });

    it("has mappings for evaluation fields with evaluation_runs table", () => {
      expect(fieldMappings["evaluations.evaluator_id"]).toBeDefined();
      expect(fieldMappings["evaluations.evaluator_id"]?.table).toBe(
        "evaluation_runs"
      );
      expect(fieldMappings["evaluations.evaluator_id"]?.column).toBe(
        "EvaluatorId"
      );

      expect(fieldMappings["evaluations.score"]).toBeDefined();
      expect(fieldMappings["evaluations.score"]?.column).toBe("Score");
    });

    it("has mappings for event fields", () => {
      expect(fieldMappings["events.event_type"]).toBeDefined();
      expect(fieldMappings["events.event_type"]?.table).toBe("stored_spans");
      expect(fieldMappings["events.event_type"]?.isArray).toBe(true);
    });
  });

  describe("getFieldMapping", () => {
    it("returns mapping for known fields", () => {
      const mapping = getFieldMapping("trace_id");
      expect(mapping).toBeDefined();
      expect(mapping?.table).toBe("trace_summaries");
      expect(mapping?.column).toBe("TraceId");
    });

    it("returns undefined for unknown fields", () => {
      const mapping = getFieldMapping("unknown.field");
      expect(mapping).toBeUndefined();
    });
  });

  describe("getTableForField", () => {
    it("returns trace_summaries for trace fields", () => {
      expect(getTableForField("trace_id")).toBe("trace_summaries");
      expect(getTableForField("metrics.total_cost")).toBe("trace_summaries");
    });

    it("returns stored_spans for span fields", () => {
      expect(getTableForField("spans.span_id")).toBe("stored_spans");
      expect(getTableForField("spans.model")).toBe("stored_spans");
    });

    it("returns evaluation_runs for evaluation fields", () => {
      expect(getTableForField("evaluations.evaluator_id")).toBe(
        "evaluation_runs"
      );
      expect(getTableForField("evaluations.score")).toBe("evaluation_runs");
    });

    it("returns trace_summaries as default for unknown fields", () => {
      expect(getTableForField("unknown.field")).toBe("trace_summaries");
    });
  });

  describe("getColumnExpression", () => {
    it("returns column expression for known fields", () => {
      expect(getColumnExpression("trace_id")).toBe("TraceId");
      expect(getColumnExpression("metrics.total_cost")).toBe("TotalCost");
    });

    it("returns map access expression for metadata fields", () => {
      expect(getColumnExpression("metadata.user_id")).toBe(
        "Attributes['langwatch.user_id']"
      );
    });

    it("returns fallback for unknown fields", () => {
      expect(getColumnExpression("unknown.field")).toBe("unknown_field");
    });
  });

  describe("requiresJoin", () => {
    it("returns null for trace_summaries fields", () => {
      expect(requiresJoin("trace_id")).toBeNull();
      expect(requiresJoin("metrics.total_cost")).toBeNull();
    });

    it("returns stored_spans for span fields", () => {
      expect(requiresJoin("spans.span_id")).toBe("stored_spans");
      expect(requiresJoin("spans.model")).toBe("stored_spans");
    });

    it("returns evaluation_runs for evaluation fields", () => {
      expect(requiresJoin("evaluations.evaluator_id")).toBe("evaluation_runs");
    });
  });

  describe("getFieldsRequiringTable", () => {
    it("returns fields for stored_spans table", () => {
      const fields = getFieldsRequiringTable("stored_spans");
      expect(fields).toContain("spans.span_id");
      expect(fields).toContain("spans.model");
      expect(fields).toContain("events.event_type");
    });

    it("returns fields for evaluation_runs table", () => {
      const fields = getFieldsRequiringTable("evaluation_runs");
      expect(fields).toContain("evaluations.evaluator_id");
      expect(fields).toContain("evaluations.score");
      expect(fields).toContain("evaluations.passed");
    });
  });

  describe("tableAliases", () => {
    it("has correct aliases for all tables", () => {
      expect(tableAliases.trace_summaries).toBe("ts");
      expect(tableAliases.stored_spans).toBe("ss");
      expect(tableAliases.evaluation_runs).toBe("es");
    });
  });

  describe("getTableAlias", () => {
    it("returns correct alias for each table", () => {
      expect(getTableAlias("trace_summaries")).toBe("ts");
      expect(getTableAlias("stored_spans")).toBe("ss");
      expect(getTableAlias("evaluation_runs")).toBe("es");
    });
  });

  describe("buildJoinClause", () => {
    it("returns empty string for trace_summaries", () => {
      expect(buildJoinClause("trace_summaries")).toBe("");
    });

    it("builds correct JOIN for stored_spans", () => {
      const join = buildJoinClause("stored_spans");
      expect(join).toContain("JOIN stored_spans ss FINAL");
      expect(join).toContain("ts.TenantId = ss.TenantId");
      expect(join).toContain("ts.TraceId = ss.TraceId");
    });

    it("builds correct JOIN for evaluation_runs", () => {
      const join = buildJoinClause("evaluation_runs");
      expect(join).toContain("JOIN evaluation_runs es FINAL");
      expect(join).toContain("ts.TenantId = es.TenantId");
      expect(join).toContain("ts.TraceId = es.TraceId");
    });
  });

  describe("qualifiedColumn", () => {
    it("prefixes simple columns with table alias", () => {
      expect(qualifiedColumn("trace_id")).toBe("ts.TraceId");
      expect(qualifiedColumn("spans.span_id")).toBe("ss.SpanId");
      expect(qualifiedColumn("evaluations.evaluator_id")).toBe("es.EvaluatorId");
    });

    it("handles map access columns correctly", () => {
      const result = qualifiedColumn("metadata.user_id");
      expect(result).toContain("ts.Attributes");
      expect(result).toContain("langwatch.user_id");
    });

    it("returns field as-is for unknown fields", () => {
      expect(qualifiedColumn("unknown.field")).toBe("unknown.field");
    });
  });
});
