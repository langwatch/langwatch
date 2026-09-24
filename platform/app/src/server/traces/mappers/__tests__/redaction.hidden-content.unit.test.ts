import { describe, expect, it } from "vitest";
import type { Span } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import {
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
} from "../redaction";

const PROMPT = "please summarise my overdue invoices";

const INPUT_HIDDEN: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: false,
  canSeeCapturedOutput: true,
  capturedInputVisibleTo: "Admins",
};

function makeSpan(params: Record<string, unknown>): Span {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    timestamps: { started_at: Date.now(), finished_at: Date.now() },
    input: {
      type: "chat_messages",
      value: [
        {
          role: "user",
          content: [
            { type: "text", text: "" },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    },
    params,
  } as unknown as Span;
}

function protect(span: Span) {
  const redactions = new Set(extractRedactionsFromAllSpanInputs([span]));
  return applySpanProtections(span, INPUT_HIDDEN, redactions).params as any;
}

describe("applySpanProtections", () => {
  describe("when the viewer cannot see a span's input", () => {
    /** @scenario "Hidden input is replaced whole in the attributes that carry it" */
    it("replaces langwatch.input whole with a placeholder naming the audience", () => {
      const params = protect(
        makeSpan({
          langwatch: {
            input: JSON.stringify({
              type: "chat_messages",
              value: [{ role: "user", content: PROMPT }],
            }),
          },
        }),
      );

      expect(params.langwatch.input).toBe("[REDACTED] (visible to Admins)");
    });

    /** @scenario "Hiding input does not blank unrelated attributes" */
    it("keeps an unrelated attribute that contains a word the input also used", () => {
      const params = protect(
        makeSpan({
          langwatch: {
            langchain: {
              run: {
                extra_params: {
                  tool_choice: "user_selected",
                  schema_type: "text",
                  max_tokens: 1024,
                },
              },
            },
          },
        }),
      );

      expect(params.langwatch.langchain.run.extra_params).toEqual({
        tool_choice: "user_selected",
        schema_type: "text",
        max_tokens: 1024,
      });
    });

    /** @scenario "Hidden input copied into another attribute is still scrubbed" */
    it("scrubs an attribute that quotes the hidden message text", () => {
      const params = protect(
        makeSpan({ app: { echo: `the user asked: ${PROMPT}` } }),
      );

      expect(params.app.echo).toBe("[REDACTED]");
    });
  });
});
