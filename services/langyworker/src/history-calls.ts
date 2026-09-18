/**
 * The tool calls a conversation's history carries, in order, as settled
 * calls in the shape the turn's own log reports them.
 *
 * The history holds them in two shapes. On a live worker they are pi's
 * messages: an assistant `toolCall` block and the `toolResult` message that
 * answers it by id. On a fresh worker the conversation arrives folded into
 * the first user message as the digest lines of its seed, one message per
 * line (digest.ts renders them): `assistant: [tool call: say {...}]`, then
 * `toolResult(say): Said.` with the result's body on that line and the ones
 * after it, up to the next label. A call is paired with the next result of
 * its name. A seed folded into a seed still renders one line per message,
 * so one reading covers both shapes.
 */
import type { SettledCall } from "./tools/turn-context.js";

const DIGEST_LABEL = /^(?:user|assistant|system|toolResult\(([^),]+)(, error)?\)): ?([\s\S]*)$/;
const DIGEST_TOOL_CALL = /\[tool call: (\S+) (\{.*\})\]$/;
/** The line the seed ends on (system-prompt.ts writes it); the user's own message follows. */
const DIGEST_END = "[End of digest.";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "object" && block !== null ? (block as { text?: unknown }).text : undefined))
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    // A line cut by the digest's per-message cap: the call is known, its input is not.
    return undefined;
  }
}

class HistoryCalls {
  readonly calls: SettledCall[] = [];
  /** Structured calls awaiting their result, by tool call id. */
  private readonly byId = new Map<string, number>();
  /** Digest calls awaiting their result, by tool name, oldest first. */
  private readonly byName = new Map<string, number[]>();
  /** The digest result whose body is being read. */
  private result: { index: number; body: string[] } | undefined;

  private push(name: string, input: unknown): number {
    this.calls.push({ name: name.toLowerCase(), input, isError: false, output: "" });
    return this.calls.length - 1;
  }

  structuredCall(block: { id?: unknown; name: string; arguments?: unknown }): void {
    this.byId.set(String(block.id), this.push(block.name, block.arguments));
  }

  structuredResult(message: { toolCallId?: unknown; content?: unknown; isError?: unknown }): void {
    const index = this.byId.get(String(message.toolCallId));
    const call = index === undefined ? undefined : this.calls[index];
    if (index === undefined || !call) return;
    this.calls[index] = { ...call, isError: message.isError === true, output: textOf(message.content) };
  }

  private flush(): void {
    const call = this.result && this.calls[this.result.index];
    if (this.result && call) this.calls[this.result.index] = { ...call, output: this.result.body.join("\n") };
    this.result = undefined;
  }

  private digestCall(text: string): void {
    const match = DIGEST_TOOL_CALL.exec(text);
    if (!match || match[1] === undefined || match[2] === undefined) return;
    const name = match[1].toLowerCase();
    const index = this.push(name, parseArguments(match[2]));
    const waiting = this.byName.get(name) ?? [];
    waiting.push(index);
    this.byName.set(name, waiting);
  }

  private digestResult({ name, error, body }: { name: string; error: boolean; body: string }): void {
    const index = this.byName.get(name.toLowerCase())?.shift();
    const call = index === undefined ? undefined : this.calls[index];
    if (index === undefined || !call) return;
    this.calls[index] = { ...call, isError: error };
    this.result = { index, body: [body] };
  }

  /** The digest lines a text carries, if any: a plain message carries none. */
  digestText(text: string): void {
    for (const line of text.split("\n")) {
      if (line.startsWith(DIGEST_END)) {
        this.flush();
        continue;
      }
      const label = DIGEST_LABEL.exec(line);
      if (label) {
        this.flush();
        const rest = label[3] ?? "";
        if (label[1] !== undefined) {
          this.digestResult({ name: label[1], error: label[2] !== undefined, body: rest });
        } else {
          this.digestCall(rest);
        }
      } else if (this.result) {
        this.result.body.push(line);
      } else {
        this.digestCall(line);
      }
    }
    this.flush();
  }
}

export function callsInHistory(messages: readonly unknown[]): SettledCall[] {
  const history = new HistoryCalls();
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as { role?: unknown; toolCallId?: unknown; content?: unknown; isError?: unknown };
    if (message.role === "toolResult") {
      history.structuredResult(message);
      continue;
    }
    if (typeof message.content === "string") {
      history.digestText(message.content);
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const raw of message.content) {
      if (typeof raw !== "object" || raw === null) continue;
      const block = raw as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown; text?: unknown };
      if (block.type === "toolCall" && typeof block.name === "string") {
        history.structuredCall({ id: block.id, name: block.name, arguments: block.arguments });
      } else if (block.type === "text" && typeof block.text === "string") {
        history.digestText(block.text);
      }
    }
  }
  return history.calls;
}
