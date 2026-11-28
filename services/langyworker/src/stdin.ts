/**
 * Strict JSONL framing for stdin: LF the only delimiter, trailing CR
 * stripped. Node's readline is not used - it also splits on U+2028/U+2029,
 * valid inside JSON strings (pi documents the same rule for its RPC mode).
 */

import { StringDecoder } from "node:string_decoder";

export interface LineSource {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

export function attachJsonlReader({
  stream,
  onLine,
  onEnd,
}: {
  stream: LineSource;
  onLine: (line: string) => void;
  onEnd?: () => void;
}): void {
  const decoder = new StringDecoder("utf8");
  // A turn line can be tens of MiB (base64 images) arriving in 64 KiB chunks:
  // only each new chunk is searched for LF, the partial line is joined once.
  let pending: string[] = [];

  const emit = (line: string) => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed.length > 0) onLine(trimmed);
  };

  stream.on("data", (chunk) => {
    let text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    let newlineIndex = text.indexOf("\n");
    while (newlineIndex !== -1) {
      emit(pending.join("") + text.slice(0, newlineIndex));
      pending = [];
      text = text.slice(newlineIndex + 1);
      newlineIndex = text.indexOf("\n");
    }
    if (text.length > 0) pending.push(text);
  });

  stream.on("end", () => {
    const rest = pending.join("") + decoder.end();
    pending = [];
    if (rest.length > 0) emit(rest);
    onEnd?.();
  });
}
