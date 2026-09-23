/**
 * The filter language against the LangWatchQL trace view: what it compiles,
 * what it names as out of reach, and whether it still agrees with the facets.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { FilterParseError, type LangWatchQLTraceFilter } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ClickHouseFacetRegistryAdapter } from "../clickhouse.trace-facet-registry.repository.ts";
import {
  ClickHouseTraceQueryLangWatchQLRepository,
  LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS,
  LANGWATCH_QL_TRACE_FILTER_FIELDS,
} from "../clickhouse.trace-query-langwatch-ql.repository.ts";

const dialect = ClickHouseTraceQueryLangWatchQLRepository.create();

function compiled(filter: string): Extract<LangWatchQLTraceFilter, { kind: "compiled" }> {
  const result = dialect.compile({ filter });
  if (result.kind !== "compiled") throw new Error(`"${filter}" compiled to ${result.kind}`);
  return result;
}

describe("given a filter compiled against the LangWatchQL trace view", () => {
  describe("when there is nothing to compile", () => {
    it("answers with no condition", () => {
      expect(dialect.compile({ filter: "   " })).toEqual({ kind: "empty" });
    });
  });

  describe("when a field is answered by a column", () => {
    /** @scenario "A supported filter field is compiled into the statement's WHERE" */
    it("compiles it with the value bound", () => {
      expect(compiled("service:checkout")).toEqual({
        kind: "compiled",
        sql: "Attributes['service.name'] = {service_0:String}",
        parameters: { service_0: "checkout" },
      });
    });

    it("compiles a numeric comparison", () => {
      expect(compiled("cost:>0.5")).toMatchObject({
        sql: "TotalCost > {cost_0:Float64}",
        parameters: { cost_0: 0.5 },
      });
    });
  });

  describe("when a field is answered by a list membership", () => {
    it("compiles an exact model to a membership test", () => {
      expect(compiled("model:gpt-5-mini").sql).toBe("has(Models, {model_0:String})");
    });

    it("compiles a wildcard model to a pattern test", () => {
      const result = compiled("model:gpt-5*");

      expect(result.sql).toContain("arrayExists(m -> m LIKE");
      expect(result.parameters).toEqual({ model_0: "gpt-5%" });
    });

    /** @scenario "A wildcard model value keeps its literal LIKE characters" */
    it("escapes the pattern's own wildcards in a wildcard model value", () => {
      expect(compiled('model:"gpt_5*100%*C:\\\\v*"').parameters).toEqual({
        model_0: "gpt\\_5%100\\%%C:\\\\v%",
      });
    });

    /** @scenario "A label is decoded before it is compared" */
    it("decodes each label element rather than unquoting it", () => {
      const result = compiled("label:beta");

      expect(result.sql).toContain("JSONExtractString(x)");
      expect(result.sql).toContain("JSONExtractArrayRaw");
      expect(result.parameters).toEqual({ label_0: "beta" });
    });
  });

  describe("when the status asked for is one the trace view cannot answer", () => {
    it("compiles the error status", () => {
      expect(compiled("status:error").sql).toBe("ContainsErrorStatus = 1");
    });

    it("refuses ok, which it would have to guess at", () => {
      expect(dialect.compile({ filter: "status:ok" })).toMatchObject({
        kind: "refused",
        field: "status",
        reason: expect.stringMatching(/only ask for status:error/),
      });
    });
  });

  describe("when the filter combines and negates fields", () => {
    /** @scenario "Boolean operators and negation are compiled" */
    it("keeps the structure", () => {
      const { sql } = compiled("(service:checkout OR service:billing) AND NOT topic:greeting");

      expect(sql).toContain(" OR ");
      expect(sql).toContain(" AND ");
      expect(sql).toContain("NOT (");
    });
  });

  describe("when the filter names a trace attribute", () => {
    /** @scenario "A trace attribute is compiled through the attribute map" */
    it("reads it off the attribute map with both halves bound", () => {
      expect(compiled("trace.attribute.tenant:acme")).toMatchObject({
        sql: "Attributes[{attrKey_0:String}] = {attrValue_1:String}",
        parameters: { attrKey_0: "tenant", attrValue_1: "acme" },
      });
    });

    it("reads the shorter spelling the explorer also accepts", () => {
      expect(compiled("attribute.tenant:acme").parameters).toMatchObject({ attrKey_0: "tenant" });
    });
  });

  describe("when the filter is a bare word", () => {
    it("matches what the trace captured and what it is called", () => {
      const result = compiled("timeout");

      expect(result.sql).toContain("CapturedInput ILIKE");
      expect(result.sql).toContain("CapturedOutput ILIKE");
      expect(result.parameters).toEqual({ text_0: "%timeout%" });
    });

    /** @scenario "Free text keeps its literal LIKE characters" */
    it("escapes the pattern's own wildcards in the text", () => {
      expect(compiled('"50%_off C:\\\\tmp"').parameters).toEqual({
        text_0: "%50\\%\\_off C:\\\\tmp%",
      });
    });
  });

  describe("when the filter names a field this dialect cannot answer", () => {
    /** @scenario "A refusal for a field the trace view cannot answer is told apart from any other refusal" */
    it("answers unsupported, naming the field and what it can answer", () => {
      expect(dialect.compile({ filter: "evaluator:my-eval" })).toEqual({
        kind: "unsupported",
        field: "evaluator",
        supportedFields: LANGWATCH_QL_TRACE_FILTER_FIELDS,
      });
    });

    it("answers unsupported for every field that reaches outside the trace row", () => {
      for (const field of ["spanName", "eval", "annotation", "size"]) {
        expect(dialect.compile({ filter: `${field}:whatever` }).kind).toBe("unsupported");
      }
    });
  });

  describe("when the filter cannot be parsed", () => {
    it("throws the language's own parse error, which carries no unsupported-field answer", () => {
      expect(() => dialect.compile({ filter: 'service:"unclosed' })).toThrow(FilterParseError);
    });
  });
});

describe("the LangWatchQL trace filter dialect, given the facet registry", () => {
  const facets = new Map(
    ClickHouseFacetRegistryAdapter.FACET_REGISTRY.flatMap((facet) =>
      "expression" in facet ? [[facet.key, facet.expression] as const] : [],
    ),
  );

  describe("when a field declares the facet it mirrors", () => {
    it("compiles the expression the facet registry publishes", () => {
      const drifted = Object.entries(LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS).filter(
        ([, field]) =>
          field.facetKey !== undefined && facets.get(field.facetKey) !== field.expression,
      );

      expect(drifted.map(([name]) => name)).toEqual([]);
    });

    it("names a facet that exists", () => {
      const keys = new Set(ClickHouseFacetRegistryAdapter.FACET_REGISTRY.map((facet) => facet.key));
      const unknown = Object.entries(LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS).filter(
        ([, field]) => field.facetKey !== undefined && !keys.has(field.facetKey),
      );

      expect(unknown.map(([name]) => name)).toEqual([]);
    });
  });

  describe("when the published field list is read", () => {
    it("holds every field the dialect answers, sorted and unique", () => {
      expect(LANGWATCH_QL_TRACE_FILTER_FIELDS).toEqual(
        expect.arrayContaining(["service", "model", "status"]),
      );
      expect([...LANGWATCH_QL_TRACE_FILTER_FIELDS]).toEqual(
        [...new Set(LANGWATCH_QL_TRACE_FILTER_FIELDS)].toSorted(),
      );
    });

    it("compiles every field it publishes", () => {
      const broken = LANGWATCH_QL_TRACE_FILTER_FIELDS.filter(
        (field) =>
          dialect.compile({ filter: `${field}:${field === "status" ? "error" : "1"}` }).kind !==
          "compiled",
      );

      expect(broken).toEqual([]);
    });
  });
});
