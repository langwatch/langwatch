/**
 * A synthetic Anthropic SDK span in Full content mode: `gen_ai.input.messages` holds one long user
 * turn padded to the asked size, the shape the SDK and the API export for a large prompt.
 */
import type { OtlpSpan } from "@langwatch/otlp/trace-request";

const SYSTEM_PROMPT = "You are a weather assistant. Use tools when needed.";

/** An Anthropic-shaped input message list whose JSON is exactly `bytes` long. */
export function anthropicInputMessages(bytes: number): string {
  const opening = "What's the weather in Amsterdam right now? Search the web first.";
  const empty = JSON.stringify([{ role: "user", parts: [{ type: "text", content: opening }] }]);
  const padding = " lorem ipsum".repeat(Math.ceil(bytes / 12)).slice(0, bytes - empty.length);
  return JSON.stringify([
    { role: "user", parts: [{ type: "text", content: `${opening}${padding}` }] },
  ]);
}

/** The attributes of one `anthropic.messages.create` span carrying `inputBytes` of input. */
export function anthropicContentSpan({
  traceId,
  spanId,
  inputBytes,
}: {
  traceId: string;
  spanId: string;
  inputBytes: number;
}): OtlpSpan {
  const startMs = Date.now() - 4_000;
  return {
    traceId,
    spanId,
    name: "anthropic.messages.create",
    kind: 3,
    startTimeUnixNano: String(startMs * 1_000_000),
    endTimeUnixNano: String((startMs + 4_000) * 1_000_000),
    attributes: [
      { key: "gen_ai.provider.name", value: { stringValue: "anthropic" } },
      { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
      { key: "gen_ai.request.model", value: { stringValue: "claude-opus-4-7" } },
      { key: "gen_ai.usage.input_tokens", value: { intValue: 1200 } },
      { key: "gen_ai.usage.output_tokens", value: { intValue: 85 } },
      {
        key: "gen_ai.system_instructions",
        value: { stringValue: JSON.stringify([{ type: "text", content: SYSTEM_PROMPT }]) },
      },
      { key: "gen_ai.input.messages", value: { stringValue: anthropicInputMessages(inputBytes) } },
      {
        key: "gen_ai.output.messages",
        value: {
          stringValue: JSON.stringify([
            { role: "assistant", parts: [{ type: "text", content: "It is sunny." }] },
          ]),
        },
      },
    ],
    events: [],
    links: [],
    status: { code: 1, message: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}
