import { describe, expect, it } from "vitest";
import type { Span } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import {
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
} from "../redaction";

const PROMPT = "please summarise my overdue invoices";
const SHORT_ANSWER = "fraud";

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
            { type: "text", text: SHORT_ANSWER },
            { type: "text", text: "Admins" },
          ],
        },
        { role: "user", content: { type: "merger with Initech", body: "" } },
      ],
    },
    params,
  } as unknown as Span;
}

function protect(span: Span): Span["params"] {
  const redactions = new Set(extractRedactionsFromAllSpanInputs([span]));
  return applySpanProtections(span, INPUT_HIDDEN, redactions).params;
}

/** The value at a dotted path inside the (nested) span params. */
function at(params: Span["params"], path: string): unknown {
  let node: unknown = params;
  for (const key of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
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

      expect(at(params, "langwatch.input")).toBe(
        "[REDACTED] (visible to Admins)",
      );
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

      expect(at(params, "langwatch.langchain.run.extra_params")).toEqual({
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

      expect(at(params, "app.echo")).toBe("[REDACTED]");
    });

    /** @scenario "Hidden input copied into another attribute is still scrubbed" */
    it("scrubs an attribute that quotes a short hidden word as a whole word", () => {
      const params = protect(
        makeSpan({ app: { verdict: `the model said ${SHORT_ANSWER}.` } }),
      );

      expect(at(params, "app.verdict")).toBe("[REDACTED]");
    });

    /** @scenario "Hidden input copied into another attribute is still scrubbed" */
    it("scrubs content that sits under a type key but is not a message shape", () => {
      const params = protect(
        makeSpan({ app: { deal: "merger with Initech" } }),
      );

      expect(at(params, "app.deal")).toBe("[REDACTED]");
    });

    /** @scenario "Hiding input does not blank unrelated attributes" */
    it("keeps attributes naming shape words the input used, binary and unknown included", () => {
      const span = makeSpan({
        app: { mode: "binary", fallback: "unknown" },
      });
      span.input = {
        type: "chat_messages",
        value: [
          {
            role: "unknown",
            content: [{ type: "binary", mimeType: "audio/wav", id: "f1" }],
          },
        ],
      } as Span["input"];
      const params = protect(span);

      expect(at(params, "app.mode")).toBe("binary");
      expect(at(params, "app.fallback")).toBe("unknown");
    });

    /** @scenario "Hiding input does not blank unrelated attributes" */
    it("keeps a value that only contains a short hidden word inside a longer word", () => {
      const params = protect(makeSpan({ app: { rule: "antifraud_v2" } }));

      expect(at(params, "app.rule")).toBe("antifraud_v2");
    });
  });

  describe("when the viewer cannot see a span's output", () => {
    /** @scenario "Hidden output is replaced whole in the attributes that carry it" */
    it("replaces the gen_ai output messages whole and leaves the input keys alone", () => {
      const span = {
        ...makeSpan({
          gen_ai: {
            input: { messages: "[visible prompt]" },
            output: { messages: "[hidden answer]" },
          },
        }),
        output: { type: "text", value: "hidden answer" },
      } as unknown as Span;
      const params = applySpanProtections(
        span,
        {
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: false,
          capturedOutputVisibleTo: "Admins",
        },
        new Set(),
      ).params;

      expect(at(params, "gen_ai.output.messages")).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(at(params, "gen_ai.input.messages")).toBe("[visible prompt]");
    });
  });
});
