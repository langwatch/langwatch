/**
 * Maps pi's native session events onto the wire protocol, tagged with the
 * turn's id. Payload shapes pass through pi's documented fields verbatim
 * (`toolCallId` -> `id`, `toolName` -> `name`, `args` -> `input`), bounded per
 * PROTOCOL.md. One mapper instance lives per turn; it also replays the
 * recorded `tool_start` input on `tool_end` (pi's end event does not carry
 * args) and mirrors successful `todowrite` calls as `plan` snapshots.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

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

/**
 * How much of a truncated tool's saved output the wire frame recovers. The
 * protocol's own field bound is the ceiling; below it, this keeps a runaway
 * command's file from being slurped whole into memory.
 */
const MAX_RECOVERED_OUTPUT_BYTES = 1024 * 1024;

/**
 * The frame's output for a settled tool: pi's bash tool truncates big output
 * to its TAIL and saves the full text to a file named in the result's
 * details. A tail cut removes the head of a JSON document, which is where its
 * structure lives, so the manager's structural reduction (built to keep ids,
 * counts and pagination under its own budget) would be left reducing a
 * fragment. Recover the saved file for the frame; the model's own context
 * keeps pi's truncated view.
 */
export function settledToolOutput(result: unknown): string {
  const text = contentText(result);
  if (typeof result !== "object" || result === null) return text;
  const details = (result as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return text;
  const path = (details as { fullOutputPath?: unknown }).fullOutputPath;
  if (typeof path !== "string" || path === "") return text;
  try {
    const fd = openSync(path, "r");
    try {
      // Size the read from the file so a small output does not allocate the cap.
      const size = fstatSync(fd).size;
      const want = Math.min(size, MAX_RECOVERED_OUTPUT_BYTES);
      if (want <= 0) return text;
      const buffer = Buffer.alloc(want);
      const read = readSync(fd, buffer, 0, want, 0);
      // A cut at the cap can land inside a code point; step back to a boundary.
      let end = read;
      if (read === MAX_RECOVERED_OUTPUT_BYTES && size > MAX_RECOVERED_OUTPUT_BYTES) {
        while (end > 0) {
          const byte = buffer[end];
          if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break;
          end--;
        }
      }
      return buffer.toString("utf8", 0, end);
    } finally {
      closeSync(fd);
    }
  } catch {
    return text;
  }
}

export class TurnEventMapper {
  private readonly toolInputs = new Map<string, unknown>();

  constructor(private readonly turnId: string) {}

  map(event: SessionEventLike): WorkerEvent[] {
    switch (event.type) {
      case "message_update": {
        const delta = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (delta?.type === "text_delta" && typeof delta.delta === "string" && delta.delta !== "") {
          return [
            {
              type: "delta",
              turnId: this.turnId,
              text: boundText({ text: delta.delta }),
            },
          ];
        }
        if (
          delta?.type === "thinking_delta" &&
          typeof delta.delta === "string" &&
          delta.delta !== ""
        ) {
          return [
            {
              type: "reasoning",
              turnId: this.turnId,
              text: boundText({ text: delta.delta }),
            },
          ];
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
            input: boundJsonValue({ value: event.args }),
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
            ...(output !== "" ? { output: boundText({ text: output }) } : {}),
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
            input: boundJsonValue({ value: input }),
            isError,
            output: boundText({ text: settledToolOutput(event.result) }),
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
