/** Prefixes every line that starts in `text` with `stamp`; a chunk may end mid-line. */
export function stampLines({
  text,
  stamp,
  atLineStart,
}: {
  text: string;
  stamp: string;
  atLineStart: boolean;
}): { text: string; atLineStart: boolean } {
  let out = "";
  let start = atLineStart;
  for (const piece of text.split(/(?<=\n)/)) {
    if (!piece) continue;
    out += (start ? `${stamp} ` : "") + piece;
    start = piece.endsWith("\n");
  }
  return { text: out, atLineStart: start };
}

type WriteDone = (error?: Error | null) => void;

/** Timestamps every stderr line (daemon.log): ours, Playwright's and Node's own warnings. */
export function stampStderr() {
  const raw = process.stderr.write.bind(process.stderr);
  let atLineStart = true;
  process.stderr.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | WriteDone,
    done?: WriteDone,
  ) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const stamped = stampLines({ text, stamp: new Date().toISOString(), atLineStart });
    atLineStart = stamped.atLineStart;
    return raw(stamped.text, typeof encoding === "function" ? encoding : done);
  };
}
