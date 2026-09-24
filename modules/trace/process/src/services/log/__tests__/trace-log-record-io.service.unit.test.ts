/**
 * Which vendor's log shape wins, and when a record falls through to the
 * next. Spring AI answers within its own scope even when empty, but an
 * unrecognised first line is passed on rather than swallowed.
 */

import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../trace-canonicalisation.service.ts";
import { TraceLogRecordIOService } from "../../trace-log-record-io.service.ts";

const service = TraceLogRecordIOService.create(TraceCanonicalisationService.create());

function record(overrides: Partial<LogRecordReceivedEventData>): LogRecordReceivedEventData {
  return {
    traceId: "t1",
    spanId: "s1",
    timeUnixMs: 1000,
    severityNumber: 9,
    severityText: "INFO",
    body: "",
    attributes: {},
    resourceAttributes: {},
    scopeName: "unknown.scope",
    scopeVersion: null,
    piiRedactionLevel: "STRICT",
    ...overrides,
  };
}

const SPRING_AI_SCOPE =
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler";
const CLAUDE_SCOPE = "com.anthropic.claude_code.events";

describe("TraceLogRecordIOService", () => {
  describe("given a Spring AI record", () => {
    describe("when the first line announces prompt content", () => {
      it("reads the rest of the body as the input", () => {
        const result = service.extractIO(
          record({ scopeName: SPRING_AI_SCOPE, body: "Chat Model Prompt Content:\nhello there" }),
        );

        expect(result).toEqual({ input: "hello there", output: null });
      });
    });

    describe("when the first line announces a completion", () => {
      it("reads the rest of the body as the output", () => {
        const result = service.extractIO(
          record({ scopeName: SPRING_AI_SCOPE, body: "Chat Model Completion:\nhi back" }),
        );

        expect(result).toEqual({ input: null, output: "hi back" });
      });
    });

    describe("when the body has an identifier but no content", () => {
      it("answers with nothing rather than passing the record on", () => {
        const result = service.extractIO(
          record({
            scopeName: SPRING_AI_SCOPE,
            body: "Chat Model Completion:",
            attributes: { "event.name": "codex.user_prompt", prompt: "not mine to read" },
          }),
        );

        expect(result).toEqual({ input: null, output: null });
      });
    });

    describe("when the first line is an identifier it does not recognise", () => {
      it("passes the record on, so another vendor can still read it", () => {
        const result = service.extractIO(
          record({
            scopeName: SPRING_AI_SCOPE,
            body: "Some Other Handler:\nbody text",
            attributes: { "event.name": "codex.user_prompt", prompt: "the real prompt" },
          }),
        );

        expect(result).toEqual({ input: "the real prompt", output: null });
      });
    });
  });

  describe("given a Claude Code record", () => {
    describe("when it is a user prompt", () => {
      it("takes the prompt as the input", () => {
        const result = service.extractIO(
          record({
            scopeName: CLAUDE_SCOPE,
            attributes: { "event.name": "user_prompt", prompt: "what does this do" },
          }),
        );

        expect(result).toEqual({ input: "what does this do", output: null });
      });
    });

    describe("when a subagent emits a prompt on some other event", () => {
      it("ignores it, so a shell command cannot become the trace input", () => {
        const result = service.extractIO(
          record({
            scopeName: CLAUDE_SCOPE,
            attributes: { "event.name": "tool_result", prompt: "env" },
          }),
        );

        expect(result).toEqual({ input: null, output: null });
      });
    });

    describe("when a conversational turn carries a reply", () => {
      it("takes it as the output", () => {
        const result = service.extractIO(
          record({
            scopeName: CLAUDE_SCOPE,
            attributes: {
              "event.name": "assistant_response",
              query_source: "repl_main_thread",
              response: "it folds spans",
            },
          }),
        );

        expect(result).toEqual({ input: null, output: "it folds spans" });
      });
    });

    describe("when a utility call carries a reply", () => {
      it("ignores it, because a generated title is not the assistant's answer", () => {
        const result = service.extractIO(
          record({
            scopeName: CLAUDE_SCOPE,
            attributes: {
              "event.name": "assistant_response",
              query_source: "generate_session_title",
              response: "Telemetry chat",
            },
          }),
        );

        expect(result).toEqual({ input: null, output: null });
      });
    });
  });

  describe("given a Codex record", () => {
    describe("when it is the user prompt event", () => {
      it("takes the prompt as the input", () => {
        const result = service.extractIO(
          record({ attributes: { "event.name": "codex.user_prompt", prompt: "run the tests" } }),
        );

        expect(result).toEqual({ input: "run the tests", output: null });
      });
    });

    describe("when it is a cost-bearing event that carries no prompt", () => {
      it("reads nothing from it", () => {
        const result = service.extractIO(
          record({ attributes: { "event.name": "codex.sse_event" } }),
        );

        expect(result).toEqual({ input: null, output: null });
      });
    });
  });
});
