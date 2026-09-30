/**
 * The LangWatchQL function allowlist, published on a `FUNCTION_NOT_ALLOWED`
 * violation (issue #8085, AC7).
 *
 * `./functionAllowlist.unit.test.ts` proves the allowlist itself — which
 * names are admitted and which are refused. This file proves the SEPARATE
 * claim that a refusal carries the complete list back to the caller, so a
 * coding agent can recover without a second round trip to
 * `GET /api/v1/query/schema` to discover what it should have called instead.
 *
 * `LWQL_ALLOWED_FUNCTION_NAMES` is a new export this file assumes
 * `../functions.ts` will grow: a sorted, deduplicated, public view of the
 * same set `isAllowedLangWatchQLFunction` enforces. Without it there is no
 * single source both the validator and the schema endpoint can publish from.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ../functions.ts
 * @see ../violations.ts
 * @see ./functionAllowlist.unit.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  isAllowedLangWatchQLFunction,
  LWQL_ALLOWED_FUNCTION_NAMES,
} from "../functions";
import { validateLangWatchQL } from "../validate";

const POLICY = {
  allowedTables: ["analytics.traces"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

function functionViolation(sql: string) {
  const result = validateLangWatchQL({ sql, ...POLICY });
  if (result.ok) {
    throw new Error(`expected a refusal, got: ${JSON.stringify(result)}`);
  }
  const violation = result.violations.find(
    (v) => v.code === "FUNCTION_NOT_ALLOWED",
  );
  if (!violation) {
    throw new Error(
      `no FUNCTION_NOT_ALLOWED violation in: ${JSON.stringify(result.violations)}`,
    );
  }
  return violation;
}

describe("the LangWatchQL function allowlist the validator enforces", () => {
  describe("given a query calling a disallowed function", () => {
    const violation = functionViolation(
      "SELECT currentUser() AS value FROM analytics.traces",
    );

    /** @scenario "A FUNCTION_NOT_ALLOWED violation carries the complete allowlist" */
    it("carries allowedFunctions as the complete, sorted, deduplicated allowlist", () => {
      expect(violation.allowedFunctions).toEqual(LWQL_ALLOWED_FUNCTION_NAMES);
      const asList = violation.allowedFunctions!;
      expect(new Set(asList).size).toBe(asList.length);
    });

    it("has allowedFunctions equal to the validator's own enforced set", () => {
      const asList = violation.allowedFunctions!;
      for (const name of asList) {
        expect(isAllowedLangWatchQLFunction(name)).toBe(true);
      }
      for (const name of LWQL_ALLOWED_FUNCTION_NAMES) {
        expect(asList).toContain(name);
      }
    });

    it("names GET /api/v1/query/schema in the message as where the list lives", () => {
      expect(violation.message).toContain("GET /api/v1/query/schema");
    });
  });
});
