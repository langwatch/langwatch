/**
 * The shorthand's filter dialect: what it compiles, what it refuses by name,
 * and whether it still agrees with the facet registry.
 *
 * The last part is the one that will catch a real regression. Half of these
 * expressions are the trace compiler's own, copied because they happen to be
 * valid over the LangWatchQL trace view as well, so the drift suite at the
 * bottom asserts each one still equals the registry's.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { describe, expect, it } from "vitest";

import { FACET_REGISTRY } from "~/server/app-layer/traces/facet-registry";
import {
  compileInstantEvalShorthandFilter,
  INSTANT_EVAL_SHORTHAND_FILTER_EXPRESSIONS,
  INSTANT_EVAL_SHORTHAND_FILTER_FIELDS,
  InstantEvalShorthandError,
} from "..";

describe("compileInstantEvalShorthandFilter, given a filter", () => {
  describe("when there is nothing to compile", () => {
    it("answers with no condition", () => {
      expect(compileInstantEvalShorthandFilter(undefined)).toBeNull();
      expect(compileInstantEvalShorthandFilter("   ")).toBeNull();
    });
  });

  describe("when a field is answered by a column", () => {
    /** @scenario "A supported filter field is compiled into the statement's WHERE" */
    it("compiles it with the value bound", () => {
      const compiled = compileInstantEvalShorthandFilter("service:checkout")!;

      expect(compiled.sql).toBe(
        "Attributes['service.name'] = {service_0:String}",
      );
      expect(compiled.parameters).toEqual({ service_0: "checkout" });
    });

    it("compiles a numeric comparison", () => {
      const compiled = compileInstantEvalShorthandFilter("cost:>0.5")!;

      expect(compiled.sql).toBe("TotalCost > {cost_0:Float64}");
      expect(compiled.parameters).toEqual({ cost_0: 0.5 });
    });
  });

  describe("when a field is answered by a list membership", () => {
    it("compiles an exact model to a membership test", () => {
      const compiled = compileInstantEvalShorthandFilter("model:gpt-5-mini")!;

      expect(compiled.sql).toBe("has(Models, {model_0:String})");
    });

    it("compiles a wildcard model to a pattern test", () => {
      const compiled = compileInstantEvalShorthandFilter("model:gpt-5*")!;

      expect(compiled.sql).toContain("arrayExists(m -> m LIKE");
      expect(compiled.parameters).toEqual({ model_0: "gpt-5%" });
    });

    it("compiles a label through the encoded label list", () => {
      const compiled = compileInstantEvalShorthandFilter("label:beta")!;

      expect(compiled.sql).toContain("JSONExtractArrayRaw");
      expect(compiled.parameters).toEqual({ label_0: "beta" });
    });

    /** @scenario "A label is decoded before it is compared" */
    it("decodes each element rather than unquoting it", () => {
      const compiled = compileInstantEvalShorthandFilter("label:beta")!;

      // The list holds JSON scalars. Stripping the quotes leaves a label
      // carrying a quote or a unicode escape spelled the JSON way, so it never
      // equals the plain value the caller typed.
      expect(compiled.sql).toContain("JSONExtractString(x)");
      expect(compiled.sql).not.toContain("trim(BOTH");
    });
  });

  describe("when the status asked for is one the trace view cannot answer", () => {
    it("compiles the error status", () => {
      expect(compileInstantEvalShorthandFilter("status:error")!.sql).toBe(
        "ContainsErrorStatus = 1",
      );
    });

    it("refuses ok, which it would have to guess at", () => {
      expect(() => compileInstantEvalShorthandFilter("status:ok")).toThrow(
        /only ask for status:error/,
      );
    });
  });

  describe("when the filter combines and negates fields", () => {
    /** @scenario "Boolean operators and negation are compiled" */
    it("keeps the structure", () => {
      const compiled = compileInstantEvalShorthandFilter(
        "(service:checkout OR service:billing) AND NOT topic:greeting",
      )!;

      expect(compiled.sql).toContain(" OR ");
      expect(compiled.sql).toContain(" AND ");
      expect(compiled.sql).toContain("NOT (");
    });
  });

  describe("when the filter names a trace attribute", () => {
    /** @scenario "A trace attribute is compiled through the attribute map" */
    it("reads it off the attribute map with both halves bound", () => {
      const compiled = compileInstantEvalShorthandFilter(
        "trace.attribute.tenant:acme",
      )!;

      expect(compiled.sql).toBe(
        "Attributes[{attrKey_0:String}] = {attrValue_1:String}",
      );
      expect(compiled.parameters).toEqual({
        attrKey_0: "tenant",
        attrValue_1: "acme",
      });
    });

    it("reads the shorter spelling the explorer also accepts", () => {
      const compiled = compileInstantEvalShorthandFilter(
        "attribute.tenant:acme",
      )!;

      expect(compiled.parameters).toMatchObject({ attrKey_0: "tenant" });
    });
  });

  describe("when the filter is a bare word", () => {
    it("matches what the trace captured and what it is called", () => {
      const compiled = compileInstantEvalShorthandFilter("timeout")!;

      expect(compiled.sql).toContain("CapturedInput ILIKE");
      expect(compiled.sql).toContain("CapturedOutput ILIKE");
      expect(compiled.parameters).toEqual({ text_0: "%timeout%" });
    });
  });

  describe("when the filter names a field this dialect cannot answer", () => {
    /** @scenario "A filter field the trace view cannot answer is refused by name" */
    it("refuses it by name and lists what it can answer", () => {
      let thrown: unknown;
      try {
        compileInstantEvalShorthandFilter("evaluator:my-eval");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InstantEvalShorthandError);
      expect((thrown as Error).message).toContain("evaluator");
      expect((thrown as Error).message).toContain("service");
      expect((thrown as Error).message).toContain("statement");
    });

    it("refuses every field that reaches outside the trace row", () => {
      for (const field of ["spanName", "eval", "annotation", "size"]) {
        expect(() =>
          compileInstantEvalShorthandFilter(`${field}:whatever`),
        ).toThrow(InstantEvalShorthandError);
      }
    });
  });

  describe("when the filter cannot be parsed", () => {
    /** @scenario "A filter the language cannot parse is refused" */
    it("says so", () => {
      expect(() =>
        compileInstantEvalShorthandFilter('service:"unclosed'),
      ).toThrow(/could not be read/);
    });
  });
});

describe("the shorthand filter dialect, given the facet registry", () => {
  describe("when a field declares the facet it mirrors", () => {
    it("compiles the expression the facet registry publishes", () => {
      const facets = new Map(
        FACET_REGISTRY.filter((facet) => "expression" in facet).map((facet) => [
          facet.key,
          (facet as { expression: string }).expression,
        ]),
      );

      const drifted = Object.entries(
        INSTANT_EVAL_SHORTHAND_FILTER_EXPRESSIONS,
      ).filter(
        ([, field]) =>
          field.facetKey !== undefined &&
          facets.get(field.facetKey) !== field.expression,
      );

      expect(
        drifted.map(([name]) => name),
        [
          "Shorthand filter fields whose expression no longer matches the facet registry.",
          "Update the expression, or drop the facetKey and say why the dialect differs:",
          ...drifted.map(
            ([name, field]) =>
              `  ${name}: ${field.expression} vs ${facets.get(field.facetKey!)}`,
          ),
        ].join("\n"),
      ).toEqual([]);
    });

    it("names a facet that exists", () => {
      const keys = new Set(FACET_REGISTRY.map((facet) => facet.key));
      const unknown = Object.entries(
        INSTANT_EVAL_SHORTHAND_FILTER_EXPRESSIONS,
      ).filter(
        ([, field]) =>
          field.facetKey !== undefined && !keys.has(field.facetKey),
      );

      expect(unknown.map(([name]) => name)).toEqual([]);
    });
  });

  describe("when the published field list is read", () => {
    it("holds every field the dialect answers, sorted and unique", () => {
      expect(INSTANT_EVAL_SHORTHAND_FILTER_FIELDS).toContain("service");
      expect(INSTANT_EVAL_SHORTHAND_FILTER_FIELDS).toContain("model");
      expect(INSTANT_EVAL_SHORTHAND_FILTER_FIELDS).toContain("status");
      expect([...INSTANT_EVAL_SHORTHAND_FILTER_FIELDS]).toEqual(
        [...new Set(INSTANT_EVAL_SHORTHAND_FILTER_FIELDS)].sort(),
      );
    });

    it("compiles every field it publishes", () => {
      const broken = INSTANT_EVAL_SHORTHAND_FILTER_FIELDS.filter((field) => {
        try {
          const value = field === "status" ? "error" : "1";
          return (
            compileInstantEvalShorthandFilter(`${field}:${value}`) === null
          );
        } catch {
          return true;
        }
      });

      expect(broken).toEqual([]);
    });
  });
});
