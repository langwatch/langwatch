import { describe, expect, it } from "vitest";
import {
  LWA_PRELUDE_SEPARATOR_LEN,
  concatBytes,
  findLWAPreludeSeparator,
} from "../index";

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Builds the byte shape AWS Lambda Web Adapter emits in RESPONSE_STREAM
 * mode: a JSON prelude with statusCode + headers, then 8 zero bytes,
 * then the response body bytes.
 */
function buildLWAResponse(
  prelude: object,
  body: string | Uint8Array,
): Uint8Array {
  const preludeBytes = enc.encode(JSON.stringify(prelude));
  const sep = new Uint8Array(LWA_PRELUDE_SEPARATOR_LEN);
  const bodyBytes = typeof body === "string" ? enc.encode(body) : body;
  return concatBytes(concatBytes(preludeBytes, sep), bodyBytes);
}

describe("findLWAPreludeSeparator", () => {
  it("finds the separator at the boundary between prelude JSON and SSE body", () => {
    // Mirrors the exact prod hex-dump shape from rchaves's project_MZZ
    // Lambda invoke (2026-04-29): prelude JSON, then 8 NULs, then the
    // bare nlpgo control SSE body.
    const buf = buildLWAResponse(
      {
        statusCode: 200,
        headers: { "content-type": "text/event-stream" },
        cookies: [],
      },
      'data: {"type":"is_alive_response"}\n\ndata: {"type":"done"}\n\n',
    );
    const sepIdx = findLWAPreludeSeparator(buf);
    expect(sepIdx).toBeGreaterThan(0);
    // The 8 bytes at sepIdx must all be zero
    for (let j = 0; j < LWA_PRELUDE_SEPARATOR_LEN; j++) {
      expect(buf[sepIdx + j]).toBe(0);
    }
    // Everything before the separator must parse as the prelude JSON
    const prelude = JSON.parse(dec.decode(buf.slice(0, sepIdx)));
    expect(prelude.statusCode).toBe(200);
    // Everything after the separator must be the original body
    expect(dec.decode(buf.slice(sepIdx + LWA_PRELUDE_SEPARATOR_LEN))).toBe(
      'data: {"type":"is_alive_response"}\n\ndata: {"type":"done"}\n\n',
    );
  });

  it("returns -1 when the buffer holds only part of the prelude (no separator yet)", () => {
    // Simulates AWS splitting the prelude across multiple PayloadChunks —
    // the strip loop must keep buffering until the separator arrives.
    const partial = enc.encode(
      '{"statusCode":200,"headers":{"content-type":"text/event-strea',
    );
    expect(findLWAPreludeSeparator(partial)).toBe(-1);
  });

  it("returns -1 for a body-only buffer that contains no 8-zero run", () => {
    // SSE bodies are text and never contain 8 NULs — guard against
    // false positives in the body scan.
    const body = enc.encode(
      'data: {"type":"is_alive_response"}\n\ndata: {"type":"done"}\n\n',
    );
    expect(findLWAPreludeSeparator(body)).toBe(-1);
  });

  it("recognises the separator even when followed immediately by body bytes (no padding)", () => {
    const tightlyPacked = concatBytes(
      enc.encode('{"statusCode":200,"headers":{},"cookies":[]}'),
      concatBytes(new Uint8Array(LWA_PRELUDE_SEPARATOR_LEN), enc.encode("d")),
    );
    const sepIdx = findLWAPreludeSeparator(tightlyPacked);
    expect(sepIdx).toBeGreaterThan(0);
    expect(
      dec.decode(tightlyPacked.slice(sepIdx + LWA_PRELUDE_SEPARATOR_LEN)),
    ).toBe("d");
  });
});

describe("concatBytes", () => {
  it("returns a single buffer holding both inputs in order", () => {
    const out = concatBytes(enc.encode("foo"), enc.encode("bar"));
    expect(dec.decode(out)).toBe("foobar");
  });

  it("treats an empty left input as identity", () => {
    const out = concatBytes(new Uint8Array(0), enc.encode("hello"));
    expect(dec.decode(out)).toBe("hello");
  });

  it("treats an empty right input as identity", () => {
    const out = concatBytes(enc.encode("hello"), new Uint8Array(0));
    expect(dec.decode(out)).toBe("hello");
  });
});

/**
 * The end-to-end behavior of invokeLambda's strip loop is hard to unit-
 * test because it lives inside a ReadableStream constructor that AWS
 * SDK populates from an EventStream. Instead, we model the strip
 * algorithm here over the same primitives the production code uses
 * (findLWAPreludeSeparator + concatBytes) and pin the behavior on the
 * three byte shapes that matter:
 *
 *   1. Prelude + body packed in ONE PayloadChunk (Go control path —
 *      this is the prod failure mode that surfaced as "Connecting…"
 *      forever on rchaves's FF=on project on 2026-04-29).
 *   2. Prelude SPLIT across two PayloadChunks (rare but possible — AWS
 *      doesn't guarantee chunk boundaries).
 *   3. Prelude in chunk 1 alone, body in chunk 2 (legacy Python uvicorn
 *      flush-per-event behavior — the historic happy case that masked
 *      the bug for a long time).
 */
describe("LWA prelude-strip end-to-end behavior", () => {
  /**
   * Mirror of the strip loop in invokeLambda's ReadableStream start():
   * accept successive chunks, return the stripped body bytes that
   * SHOULD be enqueued downstream.
   */
  function stripPrelude(chunks: Uint8Array[]): Uint8Array {
    let preludeStripped = false;
    let preludeBuffer = new Uint8Array(0);
    let body = new Uint8Array(0);
    for (const chunk of chunks) {
      let bytes = chunk;
      if (!preludeStripped) {
        const merged = concatBytes(preludeBuffer, bytes);
        const sepIdx = findLWAPreludeSeparator(merged);
        if (sepIdx === -1) {
          preludeBuffer = merged;
          continue;
        }
        bytes = merged.slice(sepIdx + LWA_PRELUDE_SEPARATOR_LEN);
        preludeStripped = true;
        preludeBuffer = new Uint8Array(0);
        if (bytes.length === 0) continue;
      }
      body = concatBytes(body, bytes);
    }
    return body;
  }

  const PRELUDE = {
    statusCode: 200,
    headers: { "content-type": "text/event-stream" },
    cookies: [],
  };
  const SSE_BODY =
    'data: {"type":"is_alive_response"}\n\ndata: {"type":"done"}\n\n';

  it("strips the prelude when prelude+body arrive in ONE chunk (the prod is_alive failure mode)", () => {
    const fullChunk = buildLWAResponse(PRELUDE, SSE_BODY);
    const body = stripPrelude([fullChunk]);
    // Without the strip, downstream split("\n\n") puts the prelude JSON
    // into events[0] and silently drops is_alive_response. With the
    // strip, the body that downstream sees is exactly the SSE bytes.
    expect(dec.decode(body)).toBe(SSE_BODY);
    // And the first frame of the stripped body MUST start with "data: "
    // so post_event/post-event.ts decodeChunk's startsWith check passes.
    expect(dec.decode(body).startsWith("data: ")).toBe(true);
  });

  it("strips the prelude when AWS splits the prelude itself across two chunks", () => {
    const full = buildLWAResponse(PRELUDE, SSE_BODY);
    // Cut somewhere inside the prelude JSON (before the 8-NUL marker).
    const cut = 30;
    const a = full.slice(0, cut);
    const b = full.slice(cut);
    const body = stripPrelude([a, b]);
    expect(dec.decode(body)).toBe(SSE_BODY);
  });

  it("strips the prelude when prelude is in chunk 1 and body in chunk 2 (uvicorn-style flush)", () => {
    // Chunk 1: prelude + 8-NUL separator only. Chunk 2: pure SSE body.
    const preludeBytes = enc.encode(JSON.stringify(PRELUDE));
    const sep = new Uint8Array(LWA_PRELUDE_SEPARATOR_LEN);
    const chunk1 = concatBytes(preludeBytes, sep);
    const chunk2 = enc.encode(SSE_BODY);
    const body = stripPrelude([chunk1, chunk2]);
    expect(dec.decode(body)).toBe(SSE_BODY);
  });

  it("preserves multi-chunk body bytes verbatim once the prelude is stripped (no \\n\\n re-splitting)", () => {
    // After the strip, downstream re-merges chunks itself. Make sure
    // we hand off bytes as-is including any trailing partial frame.
    const full = buildLWAResponse(PRELUDE, "data: {\"a\":1}\n\n");
    const tail = enc.encode("data: {\"b\":2}\n\n");
    const body = stripPrelude([full, tail]);
    expect(dec.decode(body)).toBe(
      'data: {"a":1}\n\ndata: {"b":2}\n\n',
    );
  });
});
