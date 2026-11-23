import type { TranscriptLogRecord } from "./coding-agent-transcript-state.ts";
import type { TranscriptEntry } from "./coding-agent-transcript.ts";
import { pickString } from "./telemetry/coding-agent-span.ts";

/** A Poll Claude Code adds itself, to hand over a finished script's result: `poll_<uuid>`. */
const DELIVERED_POLL_ID_PREFIX = "poll_";
const POLL_TOOL_NAME = "Poll";
const REQUEST_BODY_EVENT = "api_request_body";

type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
type Block = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
};
type Message = { role?: unknown; content?: unknown };

/**
 * The Poll calls Claude Code adds on its own: no tool span or result log is written for them,
 * so their result lives only in the next request body. One entry per call, at that request.
 */
export function collectDeliveredPolls(logs: TranscriptLogRecord[]): TranscriptEntry[] {
  const seen = new Set<string>();
  const entries: TranscriptEntry[] = [];
  for (const log of logs) {
    const event = pickString(log.attributes, "event.name");
    if (event === null || !event.endsWith(REQUEST_BODY_EVENT)) continue;

    for (const delivered of readDeliveredPolls(pickString(log.attributes, "body"))) {
      if (seen.has(delivered.id)) continue;
      seen.add(delivered.id);
      entries.push(pollEntry({ atMs: log.timestampMs, output: delivered.text }));
    }
  }
  return entries;
}

function readDeliveredPolls(body: string | null): { id: string; text: string }[] {
  const messages = parseMessages(body);
  const pollIds = new Set(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? blocksOf(message).flatMap((block) => (isDeliveredPollUse(block) ? [block.id] : []))
        : [],
    ),
  );
  if (pollIds.size === 0) return [];

  return messages.flatMap((message) =>
    message.role === "user"
      ? blocksOf(message).flatMap((block) => {
          const id = block.tool_use_id;
          if (block.type !== "tool_result" || typeof id !== "string" || !pollIds.has(id)) return [];
          return [{ id, text: resultText(block.content) }];
        })
      : [],
  );
}

function isDeliveredPollUse(block: Block): block is Block & { id: string } {
  return (
    block.type === "tool_use" &&
    block.name === POLL_TOOL_NAME &&
    typeof block.id === "string" &&
    block.id.startsWith(DELIVERED_POLL_ID_PREFIX)
  );
}

function parseMessages(body: string | null): Message[] {
  if (body === null) return [];
  try {
    const parsed = JSON.parse(body) as { messages?: unknown };
    return Array.isArray(parsed.messages) ? (parsed.messages as Message[]) : [];
  } catch {
    return [];
  }
}

function blocksOf(message: Message): Block[] {
  return Array.isArray(message.content) ? (message.content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function pollEntry({ atMs, output }: { atMs: number; output: string }): ToolEntry {
  return {
    kind: "tool",
    atMs,
    name: POLL_TOOL_NAME,
    mcpServer: null,
    input: {},
    output,
    durationMs: null,
    failed: false,
    agentId: null,
    spanId: "",
  };
}
