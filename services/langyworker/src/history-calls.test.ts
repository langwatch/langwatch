import { describe, expect, it } from "vitest";

import { callsInHistory } from "./history-calls.js";

// Backs "The continuation names what the history shows done and the step to
// continue from" in specs/langy/langy-guided-onboarding.feature: the guard
// reads the calls of the history, live or folded into a seed.

describe("callsInHistory", () => {
  /** @scenario "The continuation names what the history shows done and the step to continue from" */
  it("reads pi's toolCall blocks and the toolResult messages that answer them by id", () => {
    const calls = callsInHistory([
      { role: "user", content: "Local folder connected" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          {
            type: "toolCall",
            id: "c1",
            name: "Say",
            arguments: { text: "I found a LangGraph agent in app/graph.py." },
          },
          { type: "toolCall", id: "c2", name: "local_bash", arguments: { command: "uv sync" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "Say",
        content: [{ type: "text", text: "Said." }],
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "local_bash",
        content: [{ type: "text", text: "exit code: 1\n\nstderr:\nno uv" }],
        isError: true,
      },
    ]);
    expect(calls).toEqual([
      {
        name: "say",
        input: { text: "I found a LangGraph agent in app/graph.py." },
        isError: false,
        output: "Said.",
      },
      {
        name: "local_bash",
        input: { command: "uv sync" },
        isError: true,
        output: "exit code: 1\n\nstderr:\nno uv",
      },
    ]);
  });

  it("reads the digest lines of a folded seed, pairing each call with the next result of its name", () => {
    const seed = [
      "[Resumed conversation: digest of the previous worker's session. Newest messages last; the oldest may be truncated.]",
      "user: Guided onboarding kickoff.\nPath to set up now: llmops (Evals & LLM Ops).",
      'assistant: Reading the code.\n[tool call: say {"text":"I found a LangGraph agent in app/graph.py."}]',
      "toolResult(say): Said.",
      'assistant: [tool call: local_bash {"command":"uv sync"}]',
      "toolResult(local_bash, error): exit code: 1",
      "",
      "stderr:",
      "no uv",
      'assistant: [tool call: question {"questions":[{"header":"Propose the first scenario"}]}]',
      "toolResult(question): Q: The proposal\nA: Create it\n\nThe user has answered. Continue with the work that follows this answer in this turn.",
      "[End of digest. The user's current message follows.]",
      "",
      "Go ahead, keep going.",
    ].join("\n");
    expect(callsInHistory([{ role: "user", content: [{ type: "text", text: seed }] }])).toEqual([
      {
        name: "say",
        input: { text: "I found a LangGraph agent in app/graph.py." },
        isError: false,
        output: "Said.",
      },
      {
        name: "local_bash",
        input: { command: "uv sync" },
        isError: true,
        output: "exit code: 1\n\nstderr:\nno uv",
      },
      {
        name: "question",
        input: { questions: [{ header: "Propose the first scenario" }] },
        isError: false,
        output:
          "Q: The proposal\nA: Create it\n\nThe user has answered. Continue with the work that follows this answer in this turn.",
      },
    ]);
  });

  it("keeps a call whose line the digest cut, with no input, and reads nothing off plain messages", () => {
    expect(
      callsInHistory([
        {
          role: "user",
          content: 'assistant: [tool call: say {"text":"I found a LangGr\n[message truncated]',
        },
        { role: "assistant", content: [{ type: "text", text: "Here is what I found." }] },
        { role: "user", content: "How do I add a trace?" },
      ]),
    ).toEqual([]);
    expect(
      callsInHistory([{ role: "user", content: 'assistant: [tool call: say {"text":"cut}]' }]),
    ).toEqual([{ name: "say", input: undefined, isError: false, output: "" }]);
  });
});
