/**
 * Maps pi's native session events onto the wire protocol, tagged with the
 * turn's id, bounded per PROTOCOL.md.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

import { boundJsonValue, boundText, type WorkerEvent } from "./protocol.js";
import { ranInFolder } from "./tools/local-workspace.js";
import { normalizeTodos, TODOWRITE_TOOL_NAME } from "./tools/todowrite.js";

export type SessionEventLike = {
  type: string;
  [key: string]: unknown;
};

type ContentBlock = { type?: string; text?: string };

/** A session event field read as a string, or "" when it is not one. */
function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

/** A cut at the cap can land inside a code point; step back to a boundary. */
function codePointBoundaryBefore(buffer: Buffer, offset: number): number {
  let end = offset;
  while (end > 0) {
    const byte = buffer[end];
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break;
    end--;
  }
  return end;
}

/**
 * pi's bash tool truncates big output to its TAIL and saves the full text
 * to a file; recover it so the frame keeps the document's structure.
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
      const truncated = read === MAX_RECOVERED_OUTPUT_BYTES && size > MAX_RECOVERED_OUTPUT_BYTES;
      const end = truncated ? codePointBoundaryBefore(buffer, read) : read;
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
          return [{ type: "delta", turnId: this.turnId, text: boundText({ text: delta.delta }) }];
        }
        if (
          delta?.type === "thinking_delta" &&
          typeof delta.delta === "string" &&
          delta.delta !== ""
        ) {
          return [
            { type: "reasoning", turnId: this.turnId, text: boundText({ text: delta.delta }) },
          ];
        }
        return [];
      }
      case "tool_execution_start": {
        const id = stringField(event.toolCallId);
        const name = stringField(event.toolName);
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
            id: stringField(event.toolCallId),
            name: stringField(event.toolName),
            ...(output !== "" ? { output: boundText({ text: output }) } : {}),
          },
        ];
      }
      case "tool_execution_end":
        return this.mapToolExecutionEnd(event);
      default:
        return [];
    }
  }

  private mapToolExecutionEnd(event: SessionEventLike): WorkerEvent[] {
    const id = stringField(event.toolCallId);
    const name = stringField(event.toolName);
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
        ...(ranInFolder(event.result) ? { local: true } : {}),
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
}
