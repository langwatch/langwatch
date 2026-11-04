/**
 * The class "the caller's access refused": every violation is a gate the caller lacks or a view
 * their gates hide but a full grant would show. The view lists decide the second, never a code.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import type { LangWatchQLViolation } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { MAX_VIOLATIONS, type RefusedView } from "../langwatch-ql-validation-shape.rules.ts";
import {
  hiddenViewTables,
  isCallerAccessRejection,
  isGatedAccessRefusal,
} from "../lwql-caller-access-refusal.rules.ts";

const gated = { code: "GATED_COLUMN", missingGates: ["cost:view"] };

describe("isGatedAccessRefusal", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("is true for a not-permitted refusal whose violations all name their gates", () => {
    expect(
      isGatedAccessRefusal({
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
    expect(isGatedAccessRefusal({ error })).toBe(false);
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

  /** @scenario "A refusal cut off at the violation cap is reported" */
  it("is false once the violations reach the cap, and true one below it", () => {
    const gatedViolations = (count: number) =>
      Array.from({ length: count }, () =>
        violation({ code: "GATED_COLUMN", missingGates: ["cost:view"] }),
      );

    expect(check(gatedViolations(MAX_VIOLATIONS - 1))).toBe(true);
    expect(check(gatedViolations(MAX_VIOLATIONS))).toBe(false);
  });
});

describe("isGatedAccessRefusal at the cap", () => {
  /** @scenario "A refusal cut off at the violation cap is reported" */
  it("is false when the error carries as many gated violations as the cap", () => {
    const violations = Array.from({ length: MAX_VIOLATIONS }, () => gated);

    expect(
      isGatedAccessRefusal({ error: { code: "lwql_not_permitted", meta: { violations } } }),
    ).toBe(false);
  });
});

describe("hiddenViewTables", () => {
  /** @scenario "A caller's own access refusal is neither reported nor counted" */
  it("holds what a full grant shows and the caller does not", () => {
    const showable = [{ name: "gateway_request_spend" }, { name: "traces" }];
    const visible = [{ name: "traces" }];

    expect(hiddenViewTables({ database: "analytics", showable, visible })).toEqual(
      new Set(["analytics.gateway_request_spend"]),
    );
  });
});
