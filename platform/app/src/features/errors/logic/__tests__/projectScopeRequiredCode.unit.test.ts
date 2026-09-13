/**
 * `project_scope_required` in the application error code registry.
 *
 * The exhaustive-scan guard in `./codes.unit.test.ts` will pick this code up
 * automatically once `auth-middleware.ts` declares the literal
 * `code: "project_scope_required"` — this file asserts the two things that
 * guard does not: that the code is actually LISTED (sorted, per
 * `codes.unit.test.ts`'s own sortedness check) and that it has real
 * customer-facing copy, not the degraded "code missing" fallback.
 *
 * @see specs/analytics/lwql-query-door-self-describing.feature
 * @see ../codes.ts
 * @see ../presentation.ts
 */
import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "../codes";
import { explainHandledError } from "../presentation";
import type { HandledErrorShape } from "../readHandledError";

describe("the application error code registry", () => {
  describe("given project_scope_required", () => {
    /** @scenario project_scope_required is registered as an application error code with customer-facing copy */
    it("is listed in APP_ERROR_CODES", () => {
      expect(APP_ERROR_CODES).toContain("project_scope_required");
    });

    /** @scenario project_scope_required is registered as an application error code with customer-facing copy */
    it("has a customer-facing presentation entry, not the degraded fallback", () => {
      const wire: HandledErrorShape = {
        code: "project_scope_required" as const,
        meta: {
          required: "project_scope",
          accepted: ["X-Project-Id", "basic_auth_project_id"],
        },
        httpStatus: 401,
        fault: "customer",
        tips: [],
        docsUrl: undefined,
        traceId: undefined,
        reasons: [],
      };
      const explanation = explainHandledError(wire);

      expect(explanation.isRegistered).toBe(true);
      expect(explanation.title.length).toBeGreaterThan(0);
    });
  });
});
