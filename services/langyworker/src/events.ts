/**
 * Maps pi's native session events onto the wire protocol, tagged with the
 * turn's id. Payload shapes pass through pi's documented fields verbatim
 * (`toolCallId` -> `id`, `toolName` -> `name`, `args` -> `input`), bounded per
 * PROTOCOL.md. One mapper instance lives per turn; it also replays the
 * recorded `tool_start` input on `tool_end` (pi's end event does not carry
 * args) and mirrors successful `todowrite` calls as `plan` snapshots.
 */

import { boundJsonValue, boundText, type WorkerEvent } from "./protocol.js";
import { normalizeTodos, TODOWRITE_TOOL_NAME } from "./tools/todowrite.js";

export type SessionEventLike = {
  type: string;
  [key: string]: unknown;
};

type ContentBlock = { type?: string; text?: string };

/** Concatenate the text blocks of a tool result content array. */
export function contentText(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

export class TurnEventMapper {
  private readonly toolInputs = new Map<string, unknown>();

  constructor(private readonly turnId: string) {}

  map(event: SessionEventLike): WorkerEvent[] {
    switch (event.type) {
      case "message_update": {
        const delta = event.assistantMessageEvent as
          | { type?: string; delta?: string }
          | undefined;
        if (delta?.type === "text_delta" && typeof delta.delta === "string" && delta.delta !== "") {
          return [{ type: "delta", turnId: this.turnId, text: boundText(delta.delta) }];
        }
        if (
          delta?.type === "thinking_delta" &&
          typeof delta.delta === "string" &&
          delta.delta !== ""
        ) {
          return [{ type: "reasoning", turnId: this.turnId, text: boundText(delta.delta) }];
        }
        return [];
      }
      case "tool_execution_start": {
        const id = String(event.toolCallId ?? "");
        const name = String(event.toolName ?? "");
        this.toolInputs.set(id, event.args);
        return [
          {
            type: "tool_start",
            turnId: this.turnId,
            id,
            name,
            input: boundJsonValue(event.args),
          },
        ];
      }
      case "tool_execution_update": {
        const output = contentText(event.partialResult);
        return [
          {
            type: "tool_update",
            turnId: this.turnId,
            id: String(event.toolCallId ?? ""),
            name: String(event.toolName ?? ""),
            ...(output !== "" ? { output: boundText(output) } : {}),
          },
        ];
      }
      case "tool_execution_end": {
        const id = String(event.toolCallId ?? "");
        const name = String(event.toolName ?? "");
        const input = this.toolInputs.get(id);
        this.toolInputs.delete(id);
        const isError = event.isError === true;
        const events: WorkerEvent[] = [
          {
            type: "tool_end",
            turnId: this.turnId,
            id,
            name,
            input: boundJsonValue(input),
            isError,
            output: boundText(contentText(event.result)),
          },
        ];
        if (!isError && name.toLowerCase() === TODOWRITE_TOOL_NAME) {
          const items = normalizeTodos(input);
          if (items.length > 0) {
            events.push({ type: "plan", turnId: this.turnId, items });
          }
        }
        return events;
      }
      default:
        return [];
    }
  }
}
