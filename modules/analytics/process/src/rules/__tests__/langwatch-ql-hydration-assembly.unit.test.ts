import { describe, expect, it } from "vitest";

import {
  assembleLangWatchQLHydration,
  capLangWatchQLValue,
  DEFAULT_LWQL_HYDRATION_LIMITS,
  type LangWatchQLHydrationLimits,
} from "../langwatch-ql-hydration-assembly.rules.ts";
import {
  collectLangWatchQLKeys,
  type LangWatchQLComputedValue,
  type LangWatchQLComputedValues,
} from "../langwatch-ql-hydration-plan.rules.ts";

const resolvedCall = { column: "transcript", function: "conversation", options: [] } as const;

function computedFor(
  values: Readonly<Record<string, LangWatchQLComputedValue>>,
): LangWatchQLComputedValues {
  return new Map([["transcript", new Map(Object.entries(values))]]);
}

function value(text: string): LangWatchQLComputedValue {
  return { value: text, isTruncated: false, isResolved: true };
}

describe("assembleLangWatchQLHydration", () => {
  it("puts the rendered value in the cell the key was in, and re-declares the column", () => {
    const rows = [{ transcript: "thread-a" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });

    const result = assembleLangWatchQLHydration({
      // The server typed the column after the key it held, not the value.
      columns: [{ name: "transcript", type: "String" }],
      rows,
      resolved,
      computed: computedFor({ '["thread-a"]': value("### turn one") }),
      limits: DEFAULT_LWQL_HYDRATION_LIMITS,
    });

    expect(result.rows).toEqual([{ transcript: "### turn one" }]);
    expect(result.columns[0]?.type).toBe("Nullable(String)");
  });

  /** @scenario "A null key is not an unresolved key" */
  it("hydrates a null key to null and reports nothing, because there was no key", () => {
    const rows = [{ transcript: null }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "transcript", type: "Nullable(String)" }],
      rows,
      resolved,
      computed: computedFor({}),
      limits: DEFAULT_LWQL_HYDRATION_LIMITS,
    });

    expect(result.rows).toEqual([{ transcript: null }]);
    expect(result.unresolvedKeys).toEqual([]);
  });

  /** @scenario "A key that resolves to nothing hydrates to null and is reported" */
  it("reports a key that matched no trace, naming the function and the count", () => {
    const rows = [{ transcript: "thread-a" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "transcript", type: "Nullable(String)" }],
      rows,
      resolved,
      computed: computedFor({
        '["thread-a"]': { value: null, isTruncated: false, isResolved: false },
      }),
      limits: DEFAULT_LWQL_HYDRATION_LIMITS,
    });

    expect(result.rows).toEqual([{ transcript: null }]);
    expect(result.unresolvedKeys).toEqual([
      { column: "transcript", function: "conversation", keys: 1 },
    ]);
  });

  /** @scenario "A single value past the per-value ceiling is cut and reported" */
  it("reports how many of a call's values were cut", () => {
    const rows = [{ transcript: "thread-a" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "transcript", type: "Nullable(String)" }],
      rows,
      resolved,
      computed: computedFor({
        '["thread-a"]': { value: "cut", isTruncated: true, isResolved: true },
      }),
      limits: DEFAULT_LWQL_HYDRATION_LIMITS,
    });

    expect(result.valueTruncations).toEqual([
      { column: "transcript", function: "conversation", values: 1 },
    ]);
  });

  /** @scenario "A hydrated result past the byte ceiling drops trailing rows and says so" */
  it("drops trailing rows past the ceiling and says so, keeping a prefix of the caller's order", () => {
    const rows = [{ transcript: "thread-a" }, { transcript: "thread-b" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });
    const limits: LangWatchQLHydrationLimits = {
      ...DEFAULT_LWQL_HYDRATION_LIMITS,
      maxHydratedBytes: 40,
    };

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "transcript", type: "Nullable(String)" }],
      rows,
      resolved,
      computed: computedFor({
        '["thread-a"]': value("a".repeat(20)),
        '["thread-b"]': value("b".repeat(20)),
      }),
      limits,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ transcript: "a".repeat(20) });
    expect(result.isTruncatedByBytes).toBe(true);
  });

  /** @scenario "The result ceiling counts encoded bytes, not characters" */
  it("measures encoded bytes, so a multi-byte script costs what it weighs", () => {
    const rows = [{ transcript: "thread-a" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });
    // Twenty characters, three bytes each, past a forty-byte ceiling that
    // twenty ASCII characters would have fitted inside.
    const limits: LangWatchQLHydrationLimits = {
      ...DEFAULT_LWQL_HYDRATION_LIMITS,
      maxHydratedBytes: 40,
    };

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "transcript", type: "Nullable(String)" }],
      rows,
      resolved,
      computed: computedFor({ '["thread-a"]': value("あ".repeat(20)) }),
      limits,
    });

    expect(result.rows).toHaveLength(0);
    expect(result.isTruncatedByBytes).toBe(true);
  });

  it("leaves a column the result did not carry alone rather than inventing one", () => {
    const rows = [{ transcript: "thread-a" }];
    const resolved = collectLangWatchQLKeys({ calls: [resolvedCall], rows });

    const result = assembleLangWatchQLHydration({
      columns: [{ name: "ConversationId", type: "String" }],
      rows,
      resolved,
      computed: computedFor({ '["thread-a"]': value("text") }),
      limits: DEFAULT_LWQL_HYDRATION_LIMITS,
    });

    expect(result.columns).toEqual([{ name: "ConversationId", type: "String" }]);
  });
});

describe("capLangWatchQLValue", () => {
  /** @scenario "A single value past the per-value ceiling is cut and reported" */
  it("cuts a value past the ceiling on a character boundary and says it cut it", () => {
    const capped = capLangWatchQLValue({
      computed: { value: "あ".repeat(100), isTruncated: false, isResolved: true },
      maxBytes: 40,
    });

    expect(capped.isTruncated).toBe(true);
    expect(new TextEncoder().encode(String(capped.value)).length).toBeLessThanOrEqual(40);
  });

  it("leaves a list value alone: the thread read already bounds it", () => {
    const computed = { value: ["a", "b"], isTruncated: false, isResolved: true } as const;

    expect(capLangWatchQLValue({ computed, maxBytes: 1 })).toBe(computed);
  });
});
