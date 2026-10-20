import type { Protections, Span } from "@langwatch/trace-contract";
/**
 * When a viewer cannot see a span's input or output, the attributes that carry it are replaced
 * whole, and only real copies of the hidden content are scrubbed out of the rest. An empty
 * message part or a shape word ("user", "text") no longer blanks every other attribute.
 * @see modules/trace/specs/trace-viewer-protection.feature
 */
import { describe, expect, it } from "vitest";

import {
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
  extractRedactionsFromAllSpanOutputs,
} from "../trace-read-redaction.rules.ts";

const HIDDEN_QUESTION = "What is the refund policy for order 4471?";
const HIDDEN_ANSWER = "Refunds are issued within fourteen days.";

function chatSpan(params: Record<string, unknown>, question: string = HIDDEN_QUESTION): Span {
  const inputMessages = [
    { role: "system", content: "You are a support agent." },
    {
      role: "user",
      content: [
        { type: "text", text: question },
        { type: "text", text: "" },
      ],
    },
  ];
  const outputMessages = [{ role: "assistant", content: HIDDEN_ANSWER }];

  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    input: { type: "chat_messages", value: inputMessages },
    output: { type: "chat_messages", value: outputMessages },
    timestamps: { started_at: 1_000, finished_at: 2_000 },
    params: {
      langwatch: { input: JSON.stringify(inputMessages), output: JSON.stringify(outputMessages) },
      gen_ai: {
        input: { messages: JSON.stringify(inputMessages) },
        output: { messages: JSON.stringify(outputMessages) },
      },
      ...params,
    },
  } as Span;
}

function protect(span: Span, protections: Protections): Record<string, any> {
  const redactions = new Set([
    ...(protections.canSeeCapturedInput === true ? [] : extractRedactionsFromAllSpanInputs([span])),
    ...(protections.canSeeCapturedOutput === true
      ? []
      : extractRedactionsFromAllSpanOutputs([span])),
  ]);

  return applySpanProtections(span, protections, redactions).params as Record<string, any>;
}

const inputHiddenFromDave: Protections = {
  canSeeCapturedInput: false,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: "Admins",
  capturedOutputVisibleTo: null,
};

describe("given dave cannot see the input of a span", () => {
  describe("when dave opens that span's attributes", () => {
    /** @scenario "Hidden input is replaced whole in the attributes that carry it" */
    it("replaces the input attributes with a placeholder naming the audience", () => {
      const params = protect(chatSpan({}), inputHiddenFromDave);

      expect(params.langwatch.input).toBe("[REDACTED] (visible to Admins)");
      expect(params.gen_ai.input.messages).toBe("[REDACTED] (visible to Admins)");
    });

    /** @scenario "Hidden input is replaced whole in the attributes that carry it" */
    it("keeps the audience in the placeholder when the hidden input shares a word with it", () => {
      const params = protect(chatSpan({}, "Admins"), inputHiddenFromDave);

      expect(params.langwatch.input).toBe("[REDACTED] (visible to Admins)");
    });
  });

  describe("when the messages carry the role user and an empty text part", () => {
    /** @scenario "Hiding input does not blank unrelated attributes" */
    it("leaves unrelated attributes that mention those words visible", () => {
      const params = protect(
        chatSpan({
          extra_params: { selection: "user_selected", audience: "user", format: "text" },
          response_schema: { type: "object", required: ["answer"] },
          temperature: 0.2,
        }),
        inputHiddenFromDave,
      );

      expect(params.extra_params).toEqual({
        selection: "user_selected",
        audience: "user",
        format: "text",
      });
      expect(params.response_schema).toEqual({ type: "object", required: ["answer"] });
      expect(params.temperature).toBe(0.2);
    });
  });

  describe("when an unrelated attribute carries a copy of the input's message text", () => {
    /** @scenario "Hidden input copied into another attribute is still scrubbed" */
    it("redacts that attribute", () => {
      const params = protect(
        chatSpan({ notes: { summary: `Customer asked: ${HIDDEN_QUESTION}` } }),
        inputHiddenFromDave,
      );

      expect(params.notes.summary).toBe("[REDACTED]");
    });

    /** @scenario "Hidden input copied into another attribute is still scrubbed" */
    it("redacts a short hidden word only where it stands as a whole word", () => {
      const params = protect(
        chatSpan({ notes: { verdict: "the model said fraud.", tag: "antifraud_v2" } }, "fraud"),
        inputHiddenFromDave,
      );

      expect(params.notes.verdict).toBe("[REDACTED]");
      expect(params.notes.tag).toBe("antifraud_v2");
    });
  });
});

describe("given dave can see the input of a span but not its output", () => {
  describe("when dave opens that span's attributes", () => {
    /** @scenario "Hidden output is replaced whole in the attributes that carry it" */
    it("replaces the output messages and keeps the input messages", () => {
      const params = protect(chatSpan({}), {
        canSeeCapturedInput: true,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: null,
        capturedOutputVisibleTo: "Admins",
      });

      expect(params.gen_ai.output.messages).toBe("[REDACTED] (visible to Admins)");
      expect(JSON.parse(params.gen_ai.input.messages as string)[1].content[0].text).toBe(
        HIDDEN_QUESTION,
      );
    });
  });
});
