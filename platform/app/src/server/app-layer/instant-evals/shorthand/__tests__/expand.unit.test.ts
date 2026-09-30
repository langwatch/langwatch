/**
 * The statement each shorthand becomes: the template per target, the window,
 * how questions are named, and every refusal that happens before a statement
 * is written at all.
 *
 * Text assertions on the generated SQL, which is what a caller reads on the
 * run and edits. Whether the query policy ACCEPTS what is written is the
 * sibling suite's question (`./expandValidates.unit.test.ts`), against the
 * real parser. The call each kind of question becomes is in
 * `./question-expansion.unit.test.ts`, and where the filter lands is in
 * `./filter-expansion.unit.test.ts`.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { describe, expect, it } from "vitest";

import {
  expandInstantEvalShorthand,
  INSTANT_EVAL_SHORTHAND_TEXT_BUDGET,
  InstantEvalShorthandError,
  type InstantEvalShorthandInput,
  type InstantEvalShorthandQuestion,
  instantEvalShorthandSchema,
} from "..";

const NOW = new Date("2026-09-18T12:00:00.000Z");

const ask = (
  question: Partial<InstantEvalShorthandQuestion> = {},
): InstantEvalShorthandQuestion => ({
  kind: "boolean",
  instructions: "The customer sounds annoyed",
  ...question,
});

const expand = (shorthand: Partial<InstantEvalShorthandInput> = {}) =>
  expandInstantEvalShorthand({
    shorthand: {
      target: "traces",
      questions: [ask()],
      ...shorthand,
    } as InstantEvalShorthandInput,
    database: "analytics",
    now: NOW,
  });

describe("expandInstantEvalShorthand, given a target and some questions", () => {
  describe("when the target is traces", () => {
    /** @scenario "The traces target judges the readable trace of each trace" */
    it("judges the readable trace of each trace, ordered by the paging key", () => {
      const { sql } = expand({ target: "traces" });

      expect(sql).toContain("FROM analytics.traces");
      expect(sql).toContain("Attributes['gen_ai.conversation.id'] AS ThreadId");
      expect(sql).toContain(
        `eval(llm_readable_trace(TraceId, ${INSTANT_EVAL_SHORTHAND_TEXT_BUDGET}), 'The customer sounds annoyed') AS q1`,
      );
      expect(sql.trimEnd().endsWith("ORDER BY TraceId")).toBe(true);
    });
  });

  describe("when the target is threads", () => {
    /** @scenario "The threads target judges one bounded transcript per conversation" */
    it("groups the metrics view by conversation and judges its transcript", () => {
      const { sql } = expand({ target: "threads" });

      expect(sql).toContain("FROM analytics.trace_metrics AS m");
      expect(sql).toContain("argMax(m.TraceId, m.OccurredAt) AS TraceId");
      expect(sql).toContain("m.ConversationId AS ThreadId");
      expect(sql).toContain("max(m.OccurredAt) AS OccurredAt");
      expect(sql).toContain("GROUP BY m.ConversationId");
      expect(sql).toContain("m.ConversationId != ''");
      // Unbounded on purpose: the classifier cuts to whatever its state
      // leaves, which is several times the shipped default, so an ordinary
      // conversation reaches the judge whole.
      expect(sql).toContain("conversation(m.ConversationId)");
      expect(sql).not.toContain("conversation_bounded");
    });
  });

  describe("when the target is llm_spans", () => {
    /** @scenario "The llm_spans target judges the messages of each model call" */
    it("keeps the model calls and pages by the trace and span pair", () => {
      const { sql } = expand({ target: "llm_spans" });

      expect(sql).toContain("FROM analytics.spans");
      expect(sql).toContain("SpanAttributes['langwatch.span.type'] = 'llm'");
      expect(sql).toContain("llm_messages_span(TraceId, SpanId)");
      expect(sql).toContain("StartTime AS OccurredAt");
      expect(sql.trimEnd().endsWith("ORDER BY TraceId, SpanId")).toBe(true);
    });
  });

  describe("when no window is named", () => {
    /** @scenario "A time window is always written into the statement as bound instants" */
    it("bounds the time column between two instants covering the last week", () => {
      const { sql, parameters } = expand();

      expect(sql).toContain("OccurredAt >= {start_at:DateTime64(3, 'UTC')}");
      expect(sql).toContain("OccurredAt < {end_at:DateTime64(3, 'UTC')}");
      expect(parameters).toMatchObject({
        start_at: "2026-09-11 12:00:00.000",
        end_at: "2026-09-18 12:00:00.000",
      });
      expect(sql).not.toContain("now()");
    });
  });

  describe("when a window is named", () => {
    it("binds the instants the caller gave", () => {
      const { parameters } = expand({
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-02T00:00:00.000Z",
      });

      expect(parameters).toMatchObject({
        start_at: "2026-09-01 00:00:00.000",
        end_at: "2026-09-02 00:00:00.000",
      });
    });

    /** @scenario "A window narrower than a second keeps both of its ends" */
    it("keeps the milliseconds, so a sub-second window is not two equal bounds", () => {
      const { parameters } = expand({
        start: "2026-09-01T00:00:00.100Z",
        end: "2026-09-01T00:00:00.900Z",
      });

      expect(parameters).toMatchObject({
        start_at: "2026-09-01 00:00:00.100",
        end_at: "2026-09-01 00:00:00.900",
      });
      expect(parameters.start_at).not.toBe(parameters.end_at);
    });

    it("refuses a window that runs backwards", () => {
      expect(() =>
        expand({
          start: "2026-09-02T00:00:00.000Z",
          end: "2026-09-01T00:00:00.000Z",
        }),
      ).toThrow(InstantEvalShorthandError);
    });
  });

  describe("when the questions are long enough to crowd the classifier", () => {
    const manyOptions = (count: number, describedIn: number) =>
      ask({
        kind: "category",
        instructions: "Which of these",
        options: Array.from({ length: count }, (_, index) => ({
          name: `option_${index}`,
          description: "d".repeat(describedIn),
        })),
      });

    /** @scenario "The text budget comes from what the questions leave of the classifier's state" */
    it("writes the budget the questions leave rather than the default", () => {
      const { sql } = expand({ questions: [manyOptions(200, 480)] });

      const budget = Number(
        /llm_readable_trace\(TraceId, (\d+)\)/.exec(sql)![1],
      );
      expect(budget).toBeLessThan(INSTANT_EVAL_SHORTHAND_TEXT_BUDGET);
      expect(budget).toBeGreaterThan(0);
    });

    it("refuses questions that leave no room for any text at all", () => {
      expect(() => expand({ questions: [manyOptions(255, 500)] })).toThrow(
        /too long to leave room/,
      );
    });
  });

  describe("when there is no question at all", () => {
    /** @scenario "A shorthand with no question is refused before anything is expanded" */
    it("refuses before anything is written", () => {
      expect(() => expand({ questions: [] })).toThrow(/at least one question/i);
    });
  });
});

describe("expandInstantEvalShorthand, given how questions are named", () => {
  describe("when no ids are given", () => {
    /** @scenario "A question with no id of its own is named by its position" */
    it("names them by position", () => {
      const { sql } = expand({
        questions: [ask(), ask({ instructions: "The agent apologised" })],
      });

      expect(sql).toContain(") AS q1");
      expect(sql).toContain(") AS q2");
    });
  });

  describe("when an id is not a column name", () => {
    /** @scenario "A question id that is not a plain column name is refused" */
    it("refuses it", () => {
      expect(() => expand({ questions: [ask({ id: "it's bad" })] })).toThrow(
        /cannot name a question/,
      );
    });
  });

  describe("when an id is one the statement already projects", () => {
    /** @scenario "A question id colliding with a key column is refused" */
    it("refuses it and names the projected columns", () => {
      expect(() => expand({ questions: [ask({ id: "TraceId" })] })).toThrow(
        /already the name of a column/,
      );
    });
  });

  describe("when two questions share an id", () => {
    /** @scenario "Two questions sharing an id are refused" */
    it("refuses the second one", () => {
      expect(() =>
        expand({ questions: [ask({ id: "annoyed" }), ask({ id: "annoyed" })] }),
      ).toThrow(/already the name of a column/);
    });
  });

  describe("when the instructions carry a quote and a backslash", () => {
    /** @scenario "Instructions carrying a quote survive the expansion" */
    it("escapes both", () => {
      const { sql } = expand({
        questions: [ask({ instructions: "it's a path C:\\tmp" })],
      });

      expect(sql).toContain("'it\\'s a path C:\\\\tmp'");
    });
  });
});

describe("instantEvalShorthandSchema, given a question list", () => {
  describe("when the list is longer than the ceiling", () => {
    /** @scenario "A question list over the ceiling is refused by its count" */
    it("refuses by count rather than by the budget the questions leave", () => {
      const parsed = instantEvalShorthandSchema.safeParse({
        target: "traces",
        questions: Array.from({ length: 11 }, () => ({
          instructions: "the customer sounds annoyed",
        })),
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe("when a question is written as whitespace", () => {
    /** @scenario "A question written as whitespace is refused" */
    it("refuses instructions that carry nothing but spaces", () => {
      const parsed = instantEvalShorthandSchema.safeParse({
        target: "traces",
        questions: [{ instructions: "   " }],
      });

      expect(parsed.success).toBe(false);
    });
  });
});
