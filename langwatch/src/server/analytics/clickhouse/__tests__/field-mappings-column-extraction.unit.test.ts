import { describe, expect, it } from "vitest";
import {
  extractReferencedSpanColumns,
  extractReferencedEvaluationColumns,
  extractReferencedTraceColumns,
  narrowSpanAttributesColumns,
  spanAttributesNarrowProjection,
} from "../field-mappings";

describe("extractReferencedSpanColumns", () => {
  describe("when expression references a single column", () => {
    it("extracts DurationMs", () => {
      const result = extractReferencedSpanColumns(["ss.DurationMs > 100"]);
      expect(result).toContain("DurationMs");
      expect(result.size).toBe(1);
    });

    it("extracts StatusCode", () => {
      const result = extractReferencedSpanColumns([
        "ss.StatusCode = 'ERROR'",
      ]);
      expect(result).toContain("StatusCode");
      expect(result.size).toBe(1);
    });
  });

  describe("when expression references multiple columns", () => {
    it("extracts all referenced columns", () => {
      const result = extractReferencedSpanColumns([
        "ss.StartTime > 0",
        "ss.EndTime < 1000",
        "ss.DurationMs > 50",
      ]);
      expect(result).toContain("StartTime");
      expect(result).toContain("EndTime");
      expect(result).toContain("DurationMs");
      expect(result.size).toBe(3);
    });
  });

  describe("when expression references no known columns", () => {
    it("returns an empty set", () => {
      const result = extractReferencedSpanColumns([
        "ts.TotalCost > 0",
        "some_random_column = 1",
      ]);
      expect(result.size).toBe(0);
    });
  });

  describe("when expression contains substring false positives", () => {
    it("does not match Status when only StatusCode is present", () => {
      // "Status" is an evaluation column; "StatusCode" is a span column.
      // Naive includes("Status") would false-match on "StatusCode".
      const result = extractReferencedEvaluationColumns([
        "ss.StatusCode = 'ERROR'",
      ]);
      expect(result).not.toContain("Status");
    });

    it("does not match StartTime when only StartTimeMs is present", () => {
      const result = extractReferencedSpanColumns(["StartTimeMs > 0"]);
      expect(result).not.toContain("StartTime");
    });

    it("does not match EndTime when only EndTimeOverride is present", () => {
      const result = extractReferencedSpanColumns(["EndTimeOverride = 100"]);
      expect(result).not.toContain("EndTime");
    });
  });

  describe("when expression uses SpanAttributes map key access", () => {
    it("extracts SpanAttributes for bracket-key access", () => {
      const result = extractReferencedSpanColumns([
        "ss.SpanAttributes['gen_ai.usage.output_tokens']",
      ]);
      expect(result).toContain("SpanAttributes");
      expect(result.size).toBe(1);
    });

    it("extracts SpanAttributes for unqualified bracket-key access", () => {
      const result = extractReferencedSpanColumns([
        "SpanAttributes['gen_ai.request.model']",
      ]);
      expect(result).toContain("SpanAttributes");
      expect(result.size).toBe(1);
    });
  });

  describe("when expression uses quoted Events columns", () => {
    it('extracts "Events.Name" from quoted reference', () => {
      const result = extractReferencedSpanColumns([
        'arrayExists(x -> x = \'chat\', "Events.Name")',
      ]);
      expect(result).toContain('"Events.Name"');
    });

    it("extracts Events.Name from unquoted reference", () => {
      const result = extractReferencedSpanColumns(["Events.Name = 'chat'"]);
      expect(result).toContain('"Events.Name"');
    });
  });

  describe("when expression uses alias-qualified references", () => {
    it("extracts column with ss. alias", () => {
      const result = extractReferencedSpanColumns(["ss.DurationMs"]);
      expect(result).toContain("DurationMs");
    });
  });
});

describe("extractReferencedEvaluationColumns", () => {
  describe("when expression references a single column", () => {
    it("extracts Score", () => {
      const result = extractReferencedEvaluationColumns(["es.Score > 0.5"]);
      expect(result).toContain("Score");
      expect(result.size).toBe(1);
    });
  });

  describe("when expression references multiple columns", () => {
    it("extracts all referenced columns", () => {
      const result = extractReferencedEvaluationColumns([
        "es.Score > 0.5",
        "es.Passed = 1",
        "es.Label = 'good'",
      ]);
      expect(result).toContain("Score");
      expect(result).toContain("Passed");
      expect(result).toContain("Label");
      expect(result.size).toBe(3);
    });
  });

  describe("when expression references no known columns", () => {
    it("returns an empty set", () => {
      const result = extractReferencedEvaluationColumns([
        "ts.TotalCost > 0",
      ]);
      expect(result.size).toBe(0);
    });
  });

  describe("when expression contains substring false positives", () => {
    it("does not match Status when only StatusCode is present", () => {
      const result = extractReferencedEvaluationColumns([
        "StatusCode = 'ERROR'",
      ]);
      expect(result).not.toContain("Status");
    });

    it("does not match Score when only ScoreNormalized is present", () => {
      const result = extractReferencedEvaluationColumns([
        "ScoreNormalized > 0.5",
      ]);
      expect(result).not.toContain("Score");
    });

    it("does not match Label when only LabelCategory is present", () => {
      const result = extractReferencedEvaluationColumns([
        "LabelCategory = 'test'",
      ]);
      expect(result).not.toContain("Label");
    });
  });

  describe("when expression uses alias-qualified references", () => {
    it("extracts column with es. alias", () => {
      const result = extractReferencedEvaluationColumns([
        "es.EvaluatorType = 'llm'",
      ]);
      expect(result).toContain("EvaluatorType");
    });
  });

  describe("when Status is genuinely referenced", () => {
    it("matches Status followed by a space", () => {
      const result = extractReferencedEvaluationColumns([
        "Status = 'completed'",
      ]);
      expect(result).toContain("Status");
    });

    it("matches Status followed by a comma", () => {
      const result = extractReferencedEvaluationColumns([
        "SELECT Status, Score FROM evaluation_runs",
      ]);
      expect(result).toContain("Status");
      expect(result).toContain("Score");
    });

    it("matches Status at end of string", () => {
      const result = extractReferencedEvaluationColumns(["es.Status"]);
      expect(result).toContain("Status");
    });
  });
});

describe("extractReferencedTraceColumns", () => {
  describe("when expression references trace columns", () => {
    it("extracts the Attributes map for ts-qualified bracket access", () => {
      const result = extractReferencedTraceColumns([
        "ts.Attributes['langwatch.user_id'] = {v:String}",
      ]);
      expect(result).toContain("Attributes");
    });

    it("extracts TopicId from a filter predicate", () => {
      const result = extractReferencedTraceColumns(["ts.TopicId IN ('a')"]);
      expect(result).toContain("TopicId");
      expect(result).not.toContain("SubTopicId");
    });
  });

  describe("when expression only references span attributes", () => {
    it("does not match trace Attributes inside SpanAttributes", () => {
      // Suffix collision: "Attributes" is the tail of "SpanAttributes".
      const result = extractReferencedTraceColumns([
        "ss.SpanAttributes['gen_ai.request.model'] = {v:String}",
      ]);
      expect(result).not.toContain("Attributes");
    });

    it('does not match trace Attributes inside quoted "Events.Attributes"', () => {
      const result = extractReferencedTraceColumns([
        'mapContains(ss."Events.Attributes", \'x\')',
      ]);
      expect(result).not.toContain("Attributes");
    });
  });

  describe("when expression references no trace columns", () => {
    it("returns an empty set", () => {
      const result = extractReferencedTraceColumns([
        "ss.DurationMs > 100",
        "1=1",
      ]);
      expect(result.size).toBe(0);
    });
  });
});

describe("spanAttributesNarrowProjection", () => {
  it("reconstructs a single-key map aliased as SpanAttributes", () => {
    expect(spanAttributesNarrowProjection(["langwatch.span.type"])).toBe(
      "map('langwatch.span.type', SpanAttributes['langwatch.span.type']) AS SpanAttributes",
    );
  });

  it("reconstructs a multi-key map preserving each referenced key", () => {
    expect(
      spanAttributesNarrowProjection([
        "langwatch.span.type",
        "gen_ai.request.model",
      ]),
    ).toBe(
      "map('langwatch.span.type', SpanAttributes['langwatch.span.type'], 'gen_ai.request.model', SpanAttributes['gen_ai.request.model']) AS SpanAttributes",
    );
  });
});

describe("narrowSpanAttributesColumns", () => {
  describe("when SpanAttributes is not selected", () => {
    it("returns the column set unchanged", () => {
      const columns = new Set(["DurationMs", "StatusCode"]);
      const result = narrowSpanAttributesColumns(columns, ["ss.DurationMs > 0"]);
      expect(result).toBe(columns);
    });
  });

  describe("when every SpanAttributes use is a clean keyed access", () => {
    it("replaces the whole map with a narrow reconstructed map", () => {
      const result = narrowSpanAttributesColumns(new Set(["SpanAttributes"]), [
        "ss.SpanAttributes['langwatch.span.type']",
      ]);
      expect(result).toContain(
        "map('langwatch.span.type', SpanAttributes['langwatch.span.type']) AS SpanAttributes",
      );
      expect(result.has("SpanAttributes")).toBe(false);
    });

    it("dedupes repeated keys across expressions", () => {
      const result = narrowSpanAttributesColumns(new Set(["SpanAttributes"]), [
        "ss.SpanAttributes['langwatch.span.type'] AS field",
        "ss.SpanAttributes['langwatch.span.type'] != ''",
      ]);
      const narrow = [...result].find((c) => c.includes("map("));
      expect(narrow).toBe(
        "map('langwatch.span.type', SpanAttributes['langwatch.span.type']) AS SpanAttributes",
      );
    });

    it("keeps sibling identity columns alongside the narrow map", () => {
      const result = narrowSpanAttributesColumns(
        new Set(["TraceId", "SpanAttributes"]),
        ["ss.SpanAttributes['gen_ai.request.model']"],
      );
      expect(result.has("TraceId")).toBe(true);
      expect(result.has("SpanAttributes")).toBe(false);
    });
  });

  describe("when a SpanAttributes use cannot be reduced to a known key", () => {
    it("keeps the whole map for a generic map reference", () => {
      const columns = new Set(["SpanAttributes"]);
      const result = narrowSpanAttributesColumns(columns, [
        "mapKeys(ss.SpanAttributes)",
        "ss.SpanAttributes['langwatch.span.type']",
      ]);
      expect(result.has("SpanAttributes")).toBe(true);
      expect([...result].some((c) => c.includes("map("))).toBe(false);
    });

    it("keeps the whole map when SpanAttributes is selected but never keyed", () => {
      const columns = new Set(["SpanAttributes"]);
      const result = narrowSpanAttributesColumns(columns, ["1=1"]);
      expect(result.has("SpanAttributes")).toBe(true);
    });
  });
});
