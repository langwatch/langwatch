/**
 * @vitest-environment node
 * @see specs/nlp-go/studio-lambda-cache.feature
 */
import { describe, expect, it } from "vitest";
import { LambdaWebAdapterStreamService } from "../lambda-web-adapter-stream.service";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One Lambda Web Adapter frame: a JSON prelude, eight zero bytes, the body. */
function framed(prelude: string, body: string): Uint8Array {
  const head = encoder.encode(prelude);
  const tail = encoder.encode(body);
  const frame = new Uint8Array(head.length + 8 + tail.length);
  frame.set(head, 0);
  frame.set(tail, head.length + 8);
  return frame;
}

function readAll(stream: LambdaWebAdapterStreamService, chunks: Uint8Array[]): string {
  return chunks.map((chunk) => decoder.decode(stream.read(chunk))).join("");
}

const SSE_BODY = 'data: {"type":"is_alive_response"}\n\n';

describe("the Lambda Web Adapter response stream", () => {
  describe("given a stream that begins with a JSON prelude and eight zero bytes", () => {
    /** @scenario "Studio stream payloads retain Lambda Web Adapter behavior" */
    it("passes on only the bytes after the prelude", () => {
      const stream = LambdaWebAdapterStreamService.create();

      const forwarded = readAll(stream, [
        framed('{"statusCode":200,"headers":{},"cookies":[]}', SSE_BODY),
      ]);

      expect(forwarded).toBe(SSE_BODY);
      expect(stream.statusCode).toBe(200);
    });

    /**
     * AWS may split the prelude itself across chunks. Forwarding what has
     * arrived so far would put a bare `{` in front of the first SSE frame,
     * which is the frame the panel's heartbeat waits for.
     */
    /** @scenario "Studio stream payloads retain Lambda Web Adapter behavior" */
    it("buffers a prelude split across chunks before passing anything on", () => {
      const stream = LambdaWebAdapterStreamService.create();
      const whole = framed('{"statusCode":422,"headers":{}}', SSE_BODY);

      const first = decoder.decode(stream.read(whole.slice(0, 12)));
      const rest = decoder.decode(stream.read(whole.slice(12)));

      expect(first).toBe("");
      expect(rest).toBe(SSE_BODY);
      expect(stream.statusCode).toBe(422);
    });

    /** @scenario "Studio stream payloads retain Lambda Web Adapter behavior" */
    it("keeps the legacy 200 default when the prelude is not readable JSON", () => {
      const stream = LambdaWebAdapterStreamService.create();

      const forwarded = readAll(stream, [framed('{"statusCode": ', SSE_BODY)]);

      expect(stream.statusCode).toBe(200);
      expect(forwarded).toBe(SSE_BODY);
    });
  });

  describe("given a stream that carries no separator at all", () => {
    /** @scenario "Studio stream payloads retain Lambda Web Adapter behavior" */
    it("completes without passing on the bytes it buffered", () => {
      const stream = LambdaWebAdapterStreamService.create();

      const forwarded = readAll(stream, [
        encoder.encode('{"statusCode":200,'),
        encoder.encode('"headers":{}}'),
      ]);

      expect(forwarded).toBe("");
      expect(stream.preludeComplete).toBe(false);
    });
  });
});
