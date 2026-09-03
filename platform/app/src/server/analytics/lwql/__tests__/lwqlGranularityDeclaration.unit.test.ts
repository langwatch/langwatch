/**
 * The save-time granularity rules, and the A5 premise they rest on: that the
 * validator accepts a bound parameter *inside* an `INTERVAL` expression —
 * `INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND` — which is the whole
 * mechanism. ClickHouse compiles `INTERVAL 1 HOUR` to a function call
 * (`toIntervalHour`), so the unit of an offered step cannot itself be a
 * bound value; the seconds-multiplier form is the seam that leaves the
 * surface one value to inject. If the parser or policy refuses that shape,
 * the contract collapses and this test is the first thing to say so.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import {
  LangWatchQLGranularityRequiresTimeWindowError,
  LangWatchQLReservedGranularityTypeError,
} from "../errors";
import { assertLangWatchQLGranularityDeclaration } from "../resolveTimeWindow";
import type { LangWatchQLParameter } from "../validation/validate";
import { validateLangWatchQL } from "../validation/validate";

/** The same minimal catalog the validator's own unit test drives. */
const POLICY = {
  allowedTables: ["analytics.traces"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

const BOTH_PERIODS: LangWatchQLParameter[] = [
  { name: "dashboard_context_period_start", type: "DateTime" },
  { name: "dashboard_context_period_end", type: "DateTime" },
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
        "SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket, " +
        "count() AS events FROM traces " +
        "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime} " +
        "GROUP BY bucket ORDER BY bucket",
      ...POLICY,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.parameters).toEqual([
      { name: "dashboard_context_granularity_seconds", type: "UInt32" },
      { name: "dashboard_context_period_start", type: "DateTime" },
      { name: "dashboard_context_period_end", type: "DateTime" },
    ]);
  });
});

describe("assertLangWatchQLGranularityDeclaration (save-time rules)", () => {
  it("accepts a granularity declared alongside both period bounds", () => {
    expect(() =>
      assertLangWatchQLGranularityDeclaration([
        ...BOTH_PERIODS,
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
      ]),
    ).not.toThrow();
  });

  it("accepts a statement that does not declare granularity at all", () => {
    expect(() =>
      assertLangWatchQLGranularityDeclaration(BOTH_PERIODS),
    ).not.toThrow();
    expect(() => assertLangWatchQLGranularityDeclaration([])).not.toThrow();
  });

  it("refuses a non-UInt32 declaration", () => {
    for (const type of ["Int32", "UInt16", "UInt64", "Float64", "String"]) {
      expect(() =>
        assertLangWatchQLGranularityDeclaration([
          ...BOTH_PERIODS,
          { name: "dashboard_context_granularity_seconds", type },
        ]),
      ).toThrow(LangWatchQLReservedGranularityTypeError);
    }
  });

  it("refuses granularity declared without either period bound", () => {
    expect(() =>
      assertLangWatchQLGranularityDeclaration([
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
        { name: "dashboard_context_period_start", type: "DateTime" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);

    expect(() =>
      assertLangWatchQLGranularityDeclaration([
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);
  });

  /** @scenario "A granularity declared alongside a mistyped period bound is refused at save" */
  it("refuses granularity when a period bound is declared with a non-date-time type", () => {
    // The requires-window walk checks the bound's type too: a window bound
    // that cannot carry an instant is not a window, and the budget computed
    // against it would be fiction.
    expect(() =>
      assertLangWatchQLGranularityDeclaration([
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
        { name: "dashboard_context_period_start", type: "String" },
        { name: "dashboard_context_period_end", type: "DateTime" },
      ]),
    ).toThrow(LangWatchQLGranularityRequiresTimeWindowError);
  });

  it("tells a mistyped bound apart from an absent one in the copy", () => {
    // Both bounds are declared here. Telling the author to declare
    // dashboard_context_period_start sends them looking for a line already on screen; what
    // they have to change is its type.
    const mistyped = messageOf(() =>
      assertLangWatchQLGranularityDeclaration([
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
        { name: "dashboard_context_period_start", type: "String" },
        { name: "dashboard_context_period_end", type: "DateTime" },
      ]),
    );
    const absent = messageOf(() =>
      assertLangWatchQLGranularityDeclaration([
        { name: "dashboard_context_granularity_seconds", type: "UInt32" },
      ]),
    );

    expect(mistyped).toContain("DateTime");
    expect(mistyped).not.toBe(absent);
    expect(absent).toContain("must also declare");
  });
});
