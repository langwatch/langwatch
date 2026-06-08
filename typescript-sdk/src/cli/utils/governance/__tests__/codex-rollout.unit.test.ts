import { describe, expect, it } from "vitest";
import { type CodexChatMessage, parseCodexRollout } from "../codex-rollout";
import { buildCodexIOExportRequest } from "../codex-rollout-otlp";

const line = (obj: unknown) => JSON.stringify(obj);

function rollout(...objs: unknown[]): string {
  return objs.map(line).join("\n");
}

const taskStarted = (traceId: string, turnId: string, startedAt = 1_780_000_000) =>
  ({ type: "event_msg", payload: { type: "task_started", turn_id: turnId, trace_id: traceId, started_at: startedAt } });
const turnContext = (turnId: string, model = "gpt-5.5") =>
  ({ type: "turn_context", payload: { turn_id: turnId, model } });
const developerMsg = (text: string) =>
  ({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text }] } });
const userMsg = (text: string) =>
  ({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const assistantMsg = (text: string) =>
  ({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
const agentMessage = (message: string) =>
  ({ type: "event_msg", payload: { type: "agent_message", message, phase: "final_answer" } });
const functionCall = (name: string, args: string, callId: string) =>
  ({ type: "response_item", payload: { type: "function_call", name, arguments: args, call_id: callId } });
const functionCallOutput = (callId: string, output: string) =>
  ({ type: "response_item", payload: { type: "function_call_output", call_id: callId, output } });

const lastUser = (messages: CodexChatMessage[]) =>
  [...messages].reverse().find((m) => m.role === "user")?.content;

describe("parseCodexRollout", () => {
  describe("given a single-turn rollout", () => {
    describe("when it is parsed", () => {
      /** @scenario "A single-turn rollout yields the request body as chat messages on the turn's trace" */
      it("produces one turn carrying the turn's trace_id, request messages, and output", () => {
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
          output: "a.txt b.txt",
          model: "gpt-5.5",
        });
        expect(turns[0]!.inputMessages).toEqual([
          { role: "user", content: "list the files" },
        ]);
        expect(turns[0]!.startedAtMs).toBe(1_780_000_000 * 1000);
      });
    });
  });

  describe("given a developer message", () => {
    describe("when it is parsed", () => {
      /** @scenario "The developer message becomes the system prompt in the request body" */
      it("maps the developer role to a system message at the head of input", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            developerMsg("You are codex. Use the tools."),
            userMsg("hi"),
            assistantMsg("hello"),
          ),
        );

        expect(turns[0]!.inputMessages[0]).toEqual({
          role: "system",
          content: "You are codex. Use the tools.",
        });
        expect(lastUser(turns[0]!.inputMessages)).toBe("hi");
      });
    });
  });

  describe("given codex's injected environment_context user turn", () => {
    describe("when it is parsed", () => {
      /** @scenario "The environment_context is preserved in the request body but the prompt is the headline" */
      it("keeps the environment_context as a message while the last user message is the real prompt", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            userMsg("<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>"),
            userMsg("fix the bug"),
            assistantMsg("fixed"),
          ),
        );

        expect(turns).toHaveLength(1);
        expect(turns[0]!.inputMessages).toHaveLength(2);
        expect(turns[0]!.inputMessages[0]!.content).toContain(
          "environment_context",
        );
        expect(lastUser(turns[0]!.inputMessages)).toBe("fix the bug");
      });
    });
  });

  describe("given a multi-turn rollout", () => {
    describe("when it is parsed", () => {
      /** @scenario "A multi-turn rollout accumulates prior turns into each turn's request body" */
      it("produces one turn per task_started trace_id and folds prior turns into the next input", () => {
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
        expect(turns[0]!.inputMessages).toEqual([
          { role: "user", content: "first question" },
        ]);
        expect(turns[0]!.output).toBe("first answer");
        // Turn two carries the full prior conversation, as sent to the model.
        expect(turns[1]!.inputMessages).toEqual([
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" },
          { role: "user", content: "second question" },
        ]);
        expect(turns[1]!.output).toBe("second answer");
      });
    });
  });

  describe("given a turn that calls a tool", () => {
    describe("when it is parsed", () => {
      /** @scenario "Tool calls and their results are captured in the request body" */
      it("records the function_call as an assistant tool_call and the output as a tool message", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            userMsg("run ls"),
            assistantMsg("I'll list the files."),
            functionCall("exec_command", '{"cmd":"ls"}', "call_1"),
            functionCallOutput("call_1", "a.txt\nb.txt"),
            agentMessage("Here are the files: a.txt, b.txt"),
          ),
        );

        const input = turns[0]!.inputMessages;
        expect(input).toEqual([
          { role: "user", content: "run ls" },
          { role: "assistant", content: "I'll list the files." },
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "exec_command", arguments: '{"cmd":"ls"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "a.txt\nb.txt" },
        ]);
        expect(turns[0]!.output).toBe("Here are the files: a.txt, b.txt");
      });
    });
  });

  describe("given both an agent_message and a response_item assistant message", () => {
    describe("when it is parsed", () => {
      /** @scenario "The assistant final answer is taken from the agent_message when present" */
      it("prefers the agent_message final answer and keeps it out of the input", () => {
        const turns = parseCodexRollout(
          rollout(
            taskStarted("abc123", "t1"),
            userMsg("hi"),
            agentMessage("done"),
            assistantMsg("raw scaffold text"),
          ),
        );

        expect(turns[0]!.output).toBe("done");
        expect(turns[0]!.inputMessages).toEqual([
          { role: "user", content: "hi" },
        ]);
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
      /** @scenario "Parsed turns become OTLP spans carrying a chat_messages request body on the codex trace_id" */
      it("emits a span on the codex trace_id with a chat_messages langwatch.input and llm type", () => {
        const req = buildCodexIOExportRequest(
          [
            {
              traceId: "abc123",
              turnId: "t1",
              model: "gpt-5.5",
              inputMessages: [
                { role: "system", content: "You are codex" },
                { role: "user", content: "hi" },
              ],
              output: "hello",
              startedAtMs: null,
            },
          ],
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
        expect(JSON.parse(attrs["langwatch.input"])).toEqual({
          type: "chat_messages",
          value: [
            { role: "system", content: "You are codex" },
            { role: "user", content: "hi" },
          ],
        });
        expect(attrs["langwatch.output"]).toBe("hello");
        expect(attrs["gen_ai.response.model"]).toBe("gpt-5.5");
      });
    });
  });
});
