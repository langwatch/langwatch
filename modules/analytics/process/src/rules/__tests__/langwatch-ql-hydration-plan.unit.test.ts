import type { LangWatchQLAppFunctionCall } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  assertLangWatchQLKeyCaps,
  collectLangWatchQLKeys,
  langWatchQLDistinctKeys,
  langWatchQLExtractionPlan,
} from "../langwatch-ql-hydration-plan.rules.ts";

const conversationCall: LangWatchQLAppFunctionCall = {
  column: "transcript",
  function: "conversation",
  options: [],
};

describe("langWatchQLExtractionPlan", () => {
  it("replaces an eval call with the extraction it was written over, in the same column", () => {
    const plan = langWatchQLExtractionPlan([
      {
        column: "verdict",
        function: "eval",
        options: ["is it polite?"],
        source: { function: "conversation", options: [] },
      },
    ]);

    expect(plan).toEqual([{ column: "verdict", function: "conversation", options: [] }]);
  });

  it("drops an eval call written over a plain expression: the column already holds the text", () => {
    const plan = langWatchQLExtractionPlan([
      { column: "verdict", function: "eval", options: ["is it polite?"] },
    ]);

    expect(plan).toEqual([]);
  });

  it("keeps an extraction call as it was written", () => {
    expect(langWatchQLExtractionPlan([conversationCall])).toEqual([conversationCall]);
  });

  it("drops a call naming something that is not an app function", () => {
    expect(
      langWatchQLExtractionPlan([{ column: "x", function: "not_a_function", options: [] }]),
    ).toEqual([]);
  });
});

describe("collectLangWatchQLKeys", () => {
  /** @scenario "Repeated keys cost nothing against the cap" */
  it("counts a key once however many rows carry it", () => {
    const [resolved] = collectLangWatchQLKeys({
      calls: [conversationCall],
      rows: [{ transcript: "thread-a" }, { transcript: "thread-a" }, { transcript: "thread-b" }],
    });

    expect([...(resolved?.keys.values() ?? [])]).toEqual([["thread-a"], ["thread-b"]]);
  });

  it("ignores an empty cell, which is what a missing map lookup answers with", () => {
    const [resolved] = collectLangWatchQLKeys({
      calls: [conversationCall],
      rows: [{ transcript: "" }, { transcript: null }, { transcript: "thread-a" }],
    });

    expect(resolved?.keys.size).toBe(1);
  });

  it("follows the nested extraction's key kind for an eval written over one", () => {
    const [resolved] = collectLangWatchQLKeys({
      calls: [
        {
          column: "verdict",
          function: "eval",
          options: ["is it polite?"],
          source: { function: "conversation", options: [] },
        },
      ],
      rows: [{ verdict: "thread-a" }],
    });

    expect(resolved?.keyKind).toBe("thread");
    expect(resolved?.source?.name).toBe("conversation");
  });

  it("refuses a plan naming a function the catalogue does not declare", () => {
    expect(() =>
      collectLangWatchQLKeys({
        calls: [{ column: "x", function: "not_a_function", options: [] }],
        rows: [],
      }),
    ).toThrow(/not an app function/);
  });
});

describe("langWatchQLDistinctKeys", () => {
  it("counts a span key's trace against the trace reads, since resolving it reads its trace", () => {
    const resolved = collectLangWatchQLKeys({
      calls: [{ column: "messages", function: "llm_messages_span", options: [] }],
      rows: [
        { messages: ["trace-a", "span-1"] },
        { messages: ["trace-a", "span-2"] },
        { messages: ["trace-b", "span-1"] },
      ],
    });
    const distinct = langWatchQLDistinctKeys(resolved);

    expect([...distinct.traceIds]).toEqual(["trace-a", "trace-b"]);
    expect(distinct.spanPairs.size).toBe(3);
  });

  it("does not count half a pair: both parts have to be there for the key to mean anything", () => {
    const resolved = collectLangWatchQLKeys({
      calls: [{ column: "messages", function: "llm_messages_span", options: [] }],
      rows: [{ messages: ["trace-a", ""] }],
    });

    expect(langWatchQLDistinctKeys(resolved).traceIds.size).toBe(0);
  });
});

describe("assertLangWatchQLKeyCaps", () => {
  it("admits a plan inside every cap", () => {
    const resolved = collectLangWatchQLKeys({
      calls: [conversationCall],
      rows: [{ transcript: "thread-a" }],
    });

    expect(() => assertLangWatchQLKeyCaps(resolved)).not.toThrow();
  });

  /** @scenario "More distinct thread keys than the thread cap allows is refused the same way" */
  it("refuses by name, naming the cap, the count and the calls that spent it", () => {
    const resolved = collectLangWatchQLKeys({
      calls: [conversationCall],
      rows: Array.from({ length: 5_000 }, (_, index) => ({ transcript: `thread-${index}` })),
    });

    expect(() => assertLangWatchQLKeyCaps(resolved)).toThrowError(
      expect.objectContaining({
        code: "lwql_app_function_key_cap",
        meta: expect.objectContaining({ keyKind: "thread", functions: ["conversation"] }),
      }),
    );
  });
});
