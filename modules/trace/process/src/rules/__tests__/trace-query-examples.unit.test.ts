/**
 * Every published filter example is parsed, checked the way the search bar
 * checks it, and compiled — an example that stops translating fails here
 * rather than teaching a query the product refuses.
 * @see specs/analytics/query-reference.feature
 */

import {
  parseTraceQuerySyntax,
  TRACE_FILTER_EXAMPLES,
  describeAstProblem,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { traceQueryTranslation } from "../../services/__tests__/fixtures/trace-query-services.fixtures.ts";

const WINDOW = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

describe("given the published trace filter examples", () => {
  it("publishes at least one, each under a unique id", () => {
    expect(TRACE_FILTER_EXAMPLES.length).toBeGreaterThan(0);
    expect(new Set(TRACE_FILTER_EXAMPLES.map((example) => example.id)).size).toBe(
      TRACE_FILTER_EXAMPLES.length,
    );
  });

  describe("when each is read the way a caller would send it", () => {
    /** @scenario "Every example is runnable as published" */
    it.each(TRACE_FILTER_EXAMPLES.map((example) => [example.id, example.text] as const))(
      "[%s] parses, passes the save-time check and compiles",
      (_id, text) => {
        expect(describeAstProblem(parseTraceQuerySyntax(text))).toBeNull();
        const compiled = traceQueryTranslation.translateFilter({
          queryText: text,
          timeRange: WINDOW,
        });
        expect(compiled?.sql).toBeTruthy();
        // The compiled fragment names no tenant: the reader binds the proof's fence (ADR-175).
        expect(compiled?.params).not.toHaveProperty("tenantId");
      },
    );
  });

  describe("when a translated filter is combined with the legacy filter map", () => {
    /** @scenario "The filter's bound parameters cannot collide with the legacy filter's" */
    it("never emits a parameter the legacy builder also owns", () => {
      const legacyOwned = /^(f\d+_|spanWindowStart$|spanWindowEnd$)/;
      for (const example of TRACE_FILTER_EXAMPLES) {
        const compiled = traceQueryTranslation.translateFilter({
          queryText: example.text,
          timeRange: WINDOW,
        });
        for (const name of Object.keys(compiled?.params ?? {})) {
          expect(legacyOwned.test(name), `${example.id}: ${name}`).toBe(false);
        }
      }
    });
  });
});
