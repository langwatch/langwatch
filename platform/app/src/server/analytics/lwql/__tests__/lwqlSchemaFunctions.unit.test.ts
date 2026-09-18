/**
 * The allowed LangWatchQL functions, published on the schema itself
 * (issue #8085, AC8).
 *
 * `describeLangWatchQLSchema` already projects the catalog into views and
 * columns; this adds the one thing it does not yet carry — the function
 * allowlist a caller may use in `sql`. Pure and permission-independent: the
 * functions a query may call do not vary by what a project's key can see, so
 * this stays identical to `LWQL_ALLOWED_FUNCTION_NAMES` regardless of
 * `protections`.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ../schema.ts
 * @see ../validation/functions.ts
 */
import { describe, expect, it } from "vitest";
import type { Protections } from "../../../traces/protections";
import { describeLangWatchQLSchema } from "../schema";
import { LWQL_ALLOWED_FUNCTION_NAMES } from "../validation/functions";

const DATABASE = "analytics";

const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

describe("describeLangWatchQLSchema", () => {
  describe("given the catalog and a caller's protections", () => {
    /** @scenario "The schema endpoint publishes the allowed function names" */
    it("publishes functions as a sorted array equal to the validator's allowlist", () => {
      const schema = describeLangWatchQLSchema({
        database: DATABASE,
        protections: FULLY_PERMITTED,
      });

      expect(schema.functions).toEqual(LWQL_ALLOWED_FUNCTION_NAMES);
    });
  });
});
