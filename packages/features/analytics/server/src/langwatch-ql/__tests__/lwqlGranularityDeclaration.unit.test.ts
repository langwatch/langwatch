/**
 * The save-time granularity rules rest on a bound parameter working *inside*
 * an `INTERVAL` expression, since ClickHouse compiles it to a function call.
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import {
  LangWatchQLGranularityRequiresTimeWindowError,
  LangWatchQLReservedGranularityTypeError,
} from "@langwatch/analytics-contract";
import { LangWatchQLTimeWindowService } from "../../services/langwatch-ql-time-window.service.ts";

const timeWindows = LangWatchQLTimeWindowService.create();
import type { LangWatchQLParameter } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import { validateLangWatchQL } from "./lwql-validate.ts";

/** The same minimal catalog the validator's own unit test drives. */
const POLICY = {
  allowedTables: ["analytics.traces"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

const BOTH_PERIODS: LangWatchQLParameter[] = [
  { name: "period_start", type: "DateTime" },
  { name: "period_end", type: "DateTime" },
];

/** The `message` of a thrown error, or the reason there is none. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "<no error was thrown>";
}

describe("the validator accepts a bound parameter inside INTERVAL (A5)", () => {
  it("parses and permits the granularity multiplier in the bucketing expression", () => {
    const result = validateLangWatchQL({
      sql:
        "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
        "count() AS events FROM traces " +
        "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
        "GROUP BY bucket ORDER BY bucket",
      ...POLICY,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.parameters).toEqual([
      { name: "period_granularity_seconds", type: "UInt32" },
      { name: "period_start", type: "DateTime" },
      { name: "period_end", type: "DateTime" },
    ]);
  });
});

describe("assertLangWatchQLGranularityDeclaration (save-time rules)", () => {
  it("accepts a granularity declared alongside both period bounds", () => {
    expect(() =>
      timeWindows.assertGranularityDeclaration([
        ...BOTH_PERIODS,
        { name: "period_granularity_seconds", type: "UInt32" },
      ]),
    ).not.toThrow();
  });

  it("accepts a statement that does not declare granularity at all", () => {
    expect(() => timeWindows.assertGranularityDeclaration(BOTH_PERIODS)).not.toThrow();
    expect(() => timeWindows.assertGranularityDeclaration([])).not.toThrow();
  });

  it("refuses a non-UInt32 declaration", () => {
    for (const type of ["Int32", "UInt16", "UInt64", "Float64", "String"]) {
      expect(() =>
        timeWindows.assertGranularityDeclaration([
          ...BOTH_PERIODS,
          { name: "period_granularity_seconds", type },
        ]),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    }
  });

  it("refuses granularity declared without either period bound", () => {
    expect(() =>
      timeWindows.assertGranularityDeclaration([
        { name: "period_granularity_seconds", type: "UInt32" },
        { name: "period_start", type: "DateTime" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);

    expect(() =>
      timeWindows.assertGranularityDeclaration([
        { name: "period_granularity_seconds", type: "UInt32" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);
  });

  /** @scenario "A granularity declared alongside a mistyped period bound is refused at save" */
  it("refuses granularity when a period bound is declared with a non-date-time type", () => {
    // The requires-window walk checks the bound's type too: a window bound
    // that cannot carry an instant is not a window, and the budget computed
    // against it would be fiction.
    expect(() =>
      timeWindows.assertGranularityDeclaration([
        { name: "period_granularity_seconds", type: "UInt32" },
        { name: "period_start", type: "String" },
        { name: "period_end", type: "DateTime" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);
  });

  /** @scenario "A granularity declared alongside a mistyped period bound is refused at save" */
  it("tells a mistyped bound apart from an absent one in the copy", () => {
    // Both bounds are declared here. Telling the author to declare
    // period_start sends them looking for a line already on screen; what
    // they have to change is its type.
    const mistyped = messageOf(() =>
      timeWindows.assertGranularityDeclaration([
        { name: "period_granularity_seconds", type: "UInt32" },
        { name: "period_start", type: "String" },
        { name: "period_end", type: "DateTime" },
      ]),
    );
    const absent = messageOf(() =>
      timeWindows.assertGranularityDeclaration([
        { name: "period_granularity_seconds", type: "UInt32" },
      ]),
    );

    expect(mistyped).toContain("DateTime");
    expect(mistyped).not.toBe(absent);
    expect(absent).toContain("must also declare");
  });
});
