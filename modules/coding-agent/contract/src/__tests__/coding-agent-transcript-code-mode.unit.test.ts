import type { SpanDetail } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TranscriptLogRecord } from "../coding-agent-transcript-state.ts";
import { buildCodingAgentTranscript, type TranscriptEntry } from "../coding-agent-transcript.ts";

const REPL_SPAN_ID = "repl-span";
const SCRIPT = [
  "const lines = await Bash({ command: 'wc -l notes.txt' });",
  "const date = await Bash({ command: 'sleep 25 && date' });",
  "const hits = await Bash({ command: 'grep -n gadgets notes.txt' });",
  "return { lines, date, hits };",
].join("\n");

function span(fields: Partial<SpanDetail>): SpanDetail {
  return {
    spanId: "span",
    parentSpanId: null,
    name: "span",
    type: "span",
    startTimeMs: 0,
    endTimeMs: 0,
    durationMs: 0,
    status: "ok",
    events: [],
    ...fields,
  };
}

const replSpan = span({
  spanId: REPL_SPAN_ID,
  name: "claude_code.tool",
  startTimeMs: 1_000,
  endTimeMs: 1_020,
  durationMs: 20,
  params: { tool_name: "REPL" },
  input: JSON.stringify({ code: SCRIPT, description: "Count lines, sleep+date, grep gadgets" }),
  output: JSON.stringify({
    status: "completed",
    success: true,
    durationMs: 18,
    decision: "accept",
  }),
});

function decision(attributes: Record<string, unknown>, timestampMs: number): TranscriptLogRecord {
  return {
    timestampMs,
    attributes: { "event.name": "claude_code.tool_decision", decision: "accept", ...attributes },
  };
}

const scriptDecisions: TranscriptLogRecord[] = [
  decision({ tool_name: "REPL", tool_use_id: "toolu_01ACME" }, 990),
  decision(
    {
      tool_name: "Bash",
      tool_use_id: "repl_ab40cbcb-0001",
      tool_parameters: JSON.stringify({ bash_command: "wc", full_command: "wc -l notes.txt" }),
    },
    1_050,
  ),
  decision(
    {
      tool_name: "Bash",
      tool_use_id: "repl_ab40cbcb-0002",
      tool_parameters: JSON.stringify({ bash_command: "sleep", full_command: "sleep 25 && date" }),
    },
    1_100,
  ),
  decision({ tool_name: "Read", tool_use_id: "repl_ab40cbcb-0003" }, 26_200),
];

function toolEntries(entries: TranscriptEntry[]) {
  return entries.filter(
    (entry): entry is Extract<TranscriptEntry, { kind: "tool" }> => entry.kind === "tool",
  );
}

describe("buildCodingAgentTranscript", () => {
  describe("given a Claude Code session in Code Mode whose script ran Bash commands", () => {
    /** @scenario "The calls a Code Mode script made are listed as tool calls" */
    it("lists each call the script made as a tool call inside the script, after the script", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [replSpan],
        // Logs and spans arrive in no particular order.
        logs: [...scriptDecisions].reverse(),
      });

      const tools = toolEntries(transcript.entries);
      expect(tools.map((entry) => [entry.name, entry.inScript ?? false])).toEqual([
        ["REPL", false],
        ["Bash", true],
        ["Bash", true],
        ["Read", true],
      ]);
      expect(tools[1]).toMatchObject({
        atMs: 1_050,
        input: { bash_command: "wc", full_command: "wc -l notes.txt" },
        output: null,
        durationMs: null,
        failed: false,
      });
      expect(tools[3]?.input).toBeNull();
    });

    it("lists a call once when its decision is logged twice", () => {
      const first = scriptDecisions[1]!;
      const transcript = buildCodingAgentTranscript({ spans: [], logs: [first, first] });

      expect(toolEntries(transcript.entries)).toHaveLength(1);
    });

    it("still shows a call the user denied inside the script as rejected", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [
          decision(
            {
              tool_name: "Bash",
              tool_use_id: "repl_ab40cbcb-0004",
              decision: "reject",
              source: "user_reject",
            },
            2_000,
          ),
        ],
      });

      expect(transcript.entries).toEqual([
        expect.objectContaining({ kind: "tool_rejected", name: "Bash", outcome: "denied" }),
      ]);
    });
  });

  describe("given an accepted decision for an ordinary tool call", () => {
    it("adds nothing, since the tool's own span tells that call", () => {
      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: [decision({ tool_name: "Bash", tool_use_id: "toolu_01ACMEBASH" }, 1_000)],
      });

      expect(transcript.entries).toEqual([]);
    });
  });
});

describe("model replies in the transcript", () => {
  const modelCall = (fields: Partial<SpanDetail>) =>
    span({
      name: "claude_code.llm_request",
      type: "llm",
      startTimeMs: 500,
      endTimeMs: 900,
      durationMs: 400,
      ...fields,
    });
  const replies = (spans: SpanDetail[]) =>
    buildCodingAgentTranscript({ spans, logs: [] })
      .entries.filter((entry) => entry.kind === "assistant_message")
      .map((entry) => (entry.kind === "assistant_message" ? entry.text : ""));

  /** @scenario "A model reply that only names its tool calls adds no line of its own" */
  it("drops the tool_use rendering and keeps the prose beside it", () => {
    const toolOnly = modelCall({
      params: { query_source_safe: "repl_main_thread" },
      output: '[tool_use: REPL]\n{"code":"await Bash({ command: \'ls\' })"}',
    });
    const withProse = modelCall({
      spanId: "second",
      startTimeMs: 2_000,
      endTimeMs: 2_500,
      params: { query_source_safe: "repl_main_thread" },
      output: 'Checking the notes first.\n\n[tool_use: Bash]\n{"command":"ls"}',
    });

    expect(replies([toolOnly, withProse])).toEqual(["Checking the notes first."]);
  });

  /** @scenario "A model reply that only names its tool calls adds no line of its own" */
  it("keeps prose that only mentions the marker", () => {
    const literal = modelCall({
      params: { query_source_safe: "repl_main_thread" },
      output: "Use this literal marker: [tool_use: Bash]\nIt is documentation, not a tool call.",
    });

    expect(replies([literal])).toEqual([
      "Use this literal marker: [tool_use: Bash]\nIt is documentation, not a tool call.",
    ]);
  });

  /** @scenario "Claude Code's own utility calls are not the agent talking" */
  it("leaves out the session title call and keeps a sub-agent's reply", () => {
    const title = modelCall({
      params: { query_source_safe: "generate_session_title" },
      output: '{"title":"Notes line count"}',
    });
    const subAgent = modelCall({
      spanId: "sub",
      startTimeMs: 3_000,
      endTimeMs: 3_500,
      params: { query_source_safe: "agent:custom" },
      output: "The sub-agent found two files.",
    });

    expect(replies([title, subAgent])).toEqual(["The sub-agent found two files."]);
  });

  /** @scenario "Claude Code's own utility calls are not the agent talking" */
  it("leaves out the session title when it arrives as a log record", () => {
    const response = (attributes: Record<string, unknown>, timestampMs: number) => ({
      timestampMs,
      attributes: { "event.name": "claude_code.assistant_response", ...attributes },
    });
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [
        response({ query_source: "generate_session_title", response: '{"title":"Notes"}' }, 1_000),
        response({ query_source: "repl_main_thread", response: "notes.txt has 4 lines." }, 2_000),
      ],
    });

    const texts = transcript.entries.flatMap((entry) =>
      entry.kind === "assistant_message" ? [entry.text] : [],
    );
    expect(texts).toEqual(["notes.txt has 4 lines."]);
  });
});
