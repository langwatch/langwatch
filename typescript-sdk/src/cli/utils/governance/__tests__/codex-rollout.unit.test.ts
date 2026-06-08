import { describe, expect, it } from "vitest";
import { parseCodexRollout } from "../codex-rollout";
import { buildCodexIOExportRequest } from "../codex-rollout-otlp";

const line = (obj: unknown) => JSON.stringify(obj);

function rollout(...objs: unknown[]): string {
  return objs.map(line).join("\n");
}

const taskStarted = (traceId: string, turnId: string, startedAt = 1_780_000_000) =>
  ({ type: "event_msg", payload: { type: "task_started", turn_id: turnId, trace_id: traceId, started_at: startedAt } });
const turnContext = (turnId: string, model = "gpt-5.5") =>
  ({ type: "turn_context", payload: { turn_id: turnId, model } });
const userMsg = (text: string) =>
  ({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const assistantMsg = (text: string) =>
  ({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
const agentMessage = (message: string) =>
  ({ type: "event_msg", payload: { type: "agent_message", message, phase: "final_answer" } });

describe("parseCodexRollout", () => {
  describe("given a single-turn rollout", () => {
    describe("when it is parsed", () => {
      /** @scenario "A single-turn rollout yields one input/output pair on the turn's trace" */
      it("produces one turn carrying the turn's trace_id, input, and output", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            turnContext("t1"),
            userMsg("list the files"),
            assistantMsg("a.txt b.txt"),
          ),
        );

        expect(turns).toHaveLength(1);
        expect(turns[0]).toMatchObject({
          traceId: "abc123",
          input: "list the files",
          output: "a.txt b.txt",
          model: "gpt-5.5",
        });
        expect(turns[0]!.startedAtMs).toBe(1_780_000_000 * 1000);
      });
    });
  });

  describe("given codex's injected environment_context user turn", () => {
    describe("when it is parsed", () => {
      /** @scenario "The synthetic environment_context user message is not treated as input" */
      it("excludes the environment_context block and keeps the real prompt", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            userMsg("<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>"),
            userMsg("fix the bug"),
            assistantMsg("fixed"),
          ),
        );

        expect(turns).toHaveLength(1);
        expect(turns[0]!.input).toBe("fix the bug");
        expect(turns[0]!.input).not.toContain("environment_context");
      });
    });
  });

  describe("given a multi-turn rollout", () => {
    describe("when it is parsed", () => {
      /** @scenario "A multi-turn rollout produces one turn per task_started trace_id" */
      it("produces one turn per task_started trace_id with its own I/O", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("t-one", "turn1"),
            userMsg("first question"),
            assistantMsg("first answer"),
            taskStarted("t-two", "turn2"),
            userMsg("second question"),
            assistantMsg("second answer"),
          ),
        );

        expect(turns.map((t) => t.traceId)).toEqual(["t-one", "t-two"]);
        expect(turns[0]!.input).toBe("first question");
        expect(turns[0]!.output).toBe("first answer");
        expect(turns[1]!.input).toBe("second question");
        expect(turns[1]!.output).toBe("second answer");
      });
    });
  });

  describe("given both an agent_message and a response_item assistant message", () => {
    describe("when it is parsed", () => {
      /** @scenario "The assistant final answer is taken from the agent_message when present" */
      it("prefers the agent_message final answer", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            userMsg("hi"),
            agentMessage("done"),
            assistantMsg("raw scaffold text"),
          ),
        );

        expect(turns[0]!.output).toBe("done");
      });
    });
  });

  describe("given a turn with no assistant reply", () => {
    describe("when it is parsed", () => {
      /** @scenario "A turn with no assistant reply is dropped rather than emitting an empty span" */
      it("drops the turn entirely", () => {
        const turns = parseCodexRollout(
          rollout(taskStarted("abc123", "t1"), userMsg("are you there?")),
        );

        expect(turns).toHaveLength(0);
      });
    });
  });
});

describe("buildCodexIOExportRequest", () => {
  describe("given a parsed turn", () => {
    describe("when the I/O spans are built", () => {
      /** @scenario "Parsed turns become OTLP spans carrying langwatch input/output on the codex trace_id" */
      it("emits a span on the codex trace_id with langwatch input/output and llm type", () => {
        const req = buildCodexIOExportRequest(
          [{ traceId: "abc123", turnId: "t1", model: "gpt-5.5", input: "hi", output: "hello", startedAtMs: null }],
          1_780_000_500_000,
        );

        const span = (req.resourceSpans as any[])[0].scopeSpans[0].spans[0];
        expect(span.traceId).toBe("abc123");
        expect((req.resourceSpans as any[])[0].scopeSpans[0].scope.name).toBe(
          "langwatch.codex.rollout",
        );
        const attrs = Object.fromEntries(
          span.attributes.map((a: any) => [a.key, a.value.stringValue]),
        );
        expect(attrs["langwatch.span.type"]).toBe("llm");
        expect(attrs["langwatch.input"]).toBe("hi");
        expect(attrs["langwatch.output"]).toBe("hello");
        expect(attrs["gen_ai.response.model"]).toBe("gpt-5.5");
      });
    });
  });
});
