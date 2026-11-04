/**
 * The class "the caller's access refused" is a `lwql_not_permitted` that names what the caller
 * lacks; nothing else, whatever else it carries.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import type { LangWatchQLViolation } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import type { RefusedView } from "../langwatch-ql-validation-shape.rules.ts";
import {
  isCallerAccessRefusal,
  isCallerAccessRejection,
} from "../lwql-caller-access-refusal.rules.ts";

const gated = { code: "GATED_COLUMN", missingGates: ["cost:view"] };

describe("isCallerAccessRefusal", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("is true for a not-permitted refusal whose violations all name their gates", () => {
    expect(
      isCallerAccessRefusal({
        error: { code: "lwql_not_permitted", meta: { violations: [gated] } },
      }),
    ).toBe(true);
  });

  /** @scenario "A built-in failure that is not an access refusal is still reported" */
  it.each([
    [
      "a violation that names no gate",
      { code: "lwql_not_permitted", meta: { violations: [gated, { code: "TABLE_NOT_ALLOWED" }] } },
    ],
    ["another code carrying gates", { code: "lwql_invalid_query", meta: { violations: [gated] } }],
    ["no meta", { code: "lwql_not_permitted" }],
    ["a plain error", new Error("boom")],
    ["nothing", null],
  ])("is false for %s", (_label, error) => {
    expect(isCallerAccessRefusal({ error })).toBe(false);
  });
});

describe("isCallerAccessRejection", () => {
  const violation = (extra: Partial<LangWatchQLViolation>): LangWatchQLViolation => ({
    code: "TABLE_NOT_ALLOWED",
    clause: "projection",
    message: "The view is not available to you.",
    hint: "Use another view.",
    ...extra,
  });
  const hiddenView = violation({});
  const missingView = violation({});
  const boundParameterTable = violation({});
  const gatedColumn = violation({ code: "GATED_COLUMN", missingGates: ["cost:view"] });
  const hiddenTables = new Set(["analytics.gateway_request_spend"]);
  const refusedHidden = { violation: hiddenView, table: "analytics.gateway_request_spend" };
  const refusedMissing = { violation: missingView, table: "analytics.removed_view" };
  const check = (violations: LangWatchQLViolation[], refusedViews: RefusedView[] = []) =>
    isCallerAccessRejection({ rejection: { ok: false, violations, refusedViews }, hiddenTables });

  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("is true for a hidden view, a gated field, or both together", () => {
    expect(check([hiddenView], [refusedHidden])).toBe(true);
    expect(check([gatedColumn])).toBe(true);
    expect(check([gatedColumn, hiddenView], [refusedHidden])).toBe(true);
  });

  /** @scenario "A built-in failure that is not an access refusal is still reported" */
  it("is false when any violation is a missing view or a bound-parameter table", () => {
    expect(check([missingView], [refusedMissing])).toBe(false);
    expect(check([boundParameterTable])).toBe(false);
    expect(check([hiddenView, missingView], [refusedHidden, refusedMissing])).toBe(false);
  });
});
