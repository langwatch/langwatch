/**
 * A refusal carries the complete function allowlist back, so a caller recovers
 * without a second round trip to the schema endpoint.
 * @see specs/lwql/query-errors.feature
 */
import { describe, expect, it } from "vitest";

import {
  isAllowedLangWatchQLFunction,
  LWQL_ALLOWED_FUNCTION_NAMES,
} from "../../rules/langwatch-ql-functions.rules.ts";
import { validateLangWatchQL } from "./lwql-validate.ts";

const POLICY = {
  allowedTables: ["analytics.traces"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

function functionViolation(sql: string) {
  const result = validateLangWatchQL({ sql, ...POLICY });
  if (result.ok) throw new Error(`expected a refusal, got: ${JSON.stringify(result)}`);
  const violation = result.violations.find((entry) => entry.code === "FUNCTION_NOT_ALLOWED");
  if (!violation) {
    throw new Error(`no FUNCTION_NOT_ALLOWED violation in: ${JSON.stringify(result.violations)}`);
  }
  return violation;
}

describe("the LangWatchQL function allowlist the validator enforces", () => {
  describe("given a query calling a disallowed function", () => {
    const violation = functionViolation("SELECT currentUser() AS value FROM analytics.traces");

    /** @scenario "A FUNCTION_NOT_ALLOWED violation carries the complete allowlist" */
    it("carries allowedFunctions as the complete, sorted, deduplicated allowlist", () => {
      expect(violation.allowedFunctions).toEqual(LWQL_ALLOWED_FUNCTION_NAMES);
      const asList = violation.allowedFunctions ?? [];
      expect(new Set(asList).size).toBe(asList.length);
    });

    it("has allowedFunctions equal to the validator's own enforced set", () => {
      const asList = violation.allowedFunctions ?? [];
      for (const name of asList) expect(isAllowedLangWatchQLFunction(name)).toBe(true);
      for (const name of LWQL_ALLOWED_FUNCTION_NAMES) expect(asList).toContain(name);
    });

    it("names GET /api/v1/query/schema in the message as where the list lives", () => {
      expect(violation.message).toContain("GET /api/v1/query/schema");
    });
  });
});
