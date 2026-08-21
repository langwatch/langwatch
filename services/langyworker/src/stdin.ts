/**
 * Strict JSONL framing for stdin. LF is the only record delimiter; a trailing
 * CR is stripped. Node's readline is deliberately not used: it also splits on
 * U+2028/U+2029, which are valid inside JSON strings (pi documents the same
 * rule for its RPC mode).
 */

import { StringDecoder } from "node:string_decoder";

export interface LineSource {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

export function attachJsonlReader(
  stream: LineSource,
  onLine: (line: string) => void,
  onEnd?: () => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emit = (line: string) => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.length > 0) onLine(trimmed);
  };

  stream.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      emit(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  stream.on("end", () => {
    buffer += decoder.end();
    if (buffer.length > 0) emit(buffer);
    onEnd?.();
  });
}
