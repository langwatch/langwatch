/**
 * How the shared OTLP body reader answers a body it cannot read.
 *
 * Written against the ~190/day of 500s the `/api/otel/v1/traces` receiver was
 * returning in production. None of them were server faults: an exporter gave up
 * mid-upload, the half-read stream was torn down, and nothing on the path
 * classified that — so it reached the request boundary unhandled and was
 * answered, logged and alerted on as a 5xx.
 *
 * The `releaseLock` scenarios are the subtle half. Releasing the reader lived
 * in a `finally`, and a throw from `finally` REPLACES the error already
 * propagating, which is why the logs named a stream-internals TypeError instead
 * of the disconnect that actually happened.
 *
 * Spec: specs/otlp/otlp-body-read-failures.feature
 */

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  OtlpBodyTooLargeError,
  OtlpBodyUnreadableError,
  OtlpUnsupportedEncodingError,
} from "../errors";
import { OTLP_MAX_BODY_BYTES, readOtlpBody } from "../body";

/**
 * A Request whose body is a stream we control, so a read can be failed at an
 * arbitrary point and `getReader` can be made to hand back a reader whose
 * `releaseLock` or `cancel` throws.
 */
function requestWithStream(
  stream: ReadableStream<Uint8Array>,
  { headers }: { headers?: Record<string, string> } = {},
): Request {
  return {
    body: stream,
    headers: new Headers(headers ?? {}),
  } as unknown as Request;
}

/** A stream that yields one chunk and then errors, like a dropped connection. */
function streamThatFailsMidRead(
  error: Error = new Error("aborted"),
): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new Uint8Array([1, 2, 3]));
        return;
      }
      controller.error(error);
    },
  });
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Wrap a stream so the reader it hands out throws from the named method. Only
 * the overridden method is replaced; everything else delegates to the real
 * reader, so the read itself behaves normally.
 */
function withThrowingReader(
  stream: ReadableStream<Uint8Array>,
  method: "releaseLock" | "cancel",
  error: Error,
): ReadableStream<Uint8Array> {
  const original = stream.getReader.bind(stream);
  (stream as any).getReader = () => {
    const reader = original();
    return new Proxy(reader, {
      get(target, prop, receiver) {
        if (prop === method) {
          return () => {
            throw error;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return stream;
}

describe("readOtlpBody", () => {
  describe("given a request stream that fails part-way through", () => {
    /** @scenario A body that cannot be read is the sender's fault */
    it("reports an unreadable body rather than an unclassified error", async () => {
      const req = requestWithStream(streamThatFailsMidRead());

      await expect(readOtlpBody(req)).rejects.toBeInstanceOf(OtlpBodyUnreadableError);
    });

    it("answers 400 and attributes the failure to the sender", async () => {
      const req = requestWithStream(streamThatFailsMidRead());

      await expect(readOtlpBody(req)).rejects.toMatchObject({
        code: "ERR_BODY_UNREADABLE",
        httpStatus: 400,
        fault: "customer",
      });
    });

    /** @scenario The underlying cause is kept for diagnosis */
    it("keeps the original error for diagnosis", async () => {
      const cause = new Error("ECONNRESET");
      const req = requestWithStream(streamThatFailsMidRead(cause));

      await expect(readOtlpBody(req)).rejects.toMatchObject({
        reasons: [cause],
      });
    });
  });

  describe("given a body that has already been consumed", () => {
    /** @scenario A body that was already consumed is reported the same way */
    it("reports an unreadable body", async () => {
      const stream = streamOf(new Uint8Array([1, 2, 3]));
      // Lock the stream, so the reader the helper asks for cannot be handed out.
      stream.getReader();

      await expect(readOtlpBody(requestWithStream(stream))).rejects.toBeInstanceOf(
        OtlpBodyUnreadableError,
      );
    });
  });

  describe("given releasing the reader throws", () => {
    const releaseFailure = new TypeError(
      "Cannot read private member #state from an object whose class did not declare it",
    );

    describe("when the read also failed", () => {
      /** @scenario Releasing the reader never replaces the failure being reported */
      it("still reports the unreadable body, not the release failure", async () => {
        const stream = withThrowingReader(
          streamThatFailsMidRead(new Error("aborted")),
          "releaseLock",
          releaseFailure,
        );

        // The regression this whole file exists for: a throw from `finally`
        // used to overwrite the error on its way out.
        await expect(readOtlpBody(requestWithStream(stream))).rejects.toBeInstanceOf(
          OtlpBodyUnreadableError,
        );
      });

      it("does not surface the release failure as the reported error", async () => {
        const stream = withThrowingReader(
          streamThatFailsMidRead(new Error("aborted")),
          "releaseLock",
          releaseFailure,
        );

        await expect(readOtlpBody(requestWithStream(stream))).rejects.not.toThrow(
          /private member/,
        );
      });
    });

    describe("when the read succeeded", () => {
      /** @scenario Releasing the reader never fails a successful read */
      it("returns the body intact", async () => {
        const payload = new Uint8Array([9, 8, 7]);
        const stream = withThrowingReader(
          streamOf(payload),
          "releaseLock",
          releaseFailure,
        );

        const body = await readOtlpBody(requestWithStream(stream));
        expect(new Uint8Array(body)).toEqual(payload);
      });
    });
  });

  describe("given a body that passes the byte limit", () => {
    function oversizedStream(): ReadableStream<Uint8Array> {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          // 1 MiB at a time until the cap is comfortably passed.
          const chunk = new Uint8Array(1024 * 1024);
          sent += chunk.byteLength;
          controller.enqueue(chunk);
          if (sent > OTLP_MAX_BODY_BYTES + 1024 * 1024) controller.close();
        },
      });
    }

    /** @scenario An over-sized body is still refused as too large */
    it("is refused as too large, not merely unreadable", async () => {
      await expect(
        readOtlpBody(requestWithStream(oversizedStream())),
      ).rejects.toBeInstanceOf(OtlpBodyTooLargeError);
    });

    /** @scenario A cancel that throws does not hide the size refusal */
    it("keeps its 413 when cancelling the reader throws", async () => {
      const stream = withThrowingReader(
        oversizedStream(),
        "cancel",
        new Error("cancel exploded"),
      );

      await expect(readOtlpBody(requestWithStream(stream))).rejects.toMatchObject({
        code: "ERR_PAYLOAD_TOO_LARGE",
        httpStatus: 413,
      });
    });
  });

  describe("given an unsupported content encoding", () => {
    /** @scenario An unsupported content encoding is answered as a client error */
    it("is a client error, not a server error", async () => {
      const req = requestWithStream(streamOf(new Uint8Array([1])), {
        headers: { "content-encoding": "snappy" },
      });

      await expect(readOtlpBody(req)).rejects.toBeInstanceOf(
        OtlpUnsupportedEncodingError,
      );
    });

    it("answers 400 and names the encoding refused", async () => {
      const req = requestWithStream(streamOf(new Uint8Array([1])), {
        headers: { "content-encoding": "snappy" },
      });

      await expect(readOtlpBody(req)).rejects.toMatchObject({
        httpStatus: 400,
        meta: { encoding: "snappy" },
      });
    });
  });

  describe("given a body that does not decompress", () => {
    /** A fresh request each time - a stream cannot be read twice. */
    const undecompressable = () =>
      requestWithStream(streamOf(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), {
        headers: { "content-encoding": "gzip" },
      });

    /** @scenario A body that does not decompress is the sender's fault */
    it("is reported as unreadable rather than as a server fault", async () => {
      await expect(readOtlpBody(undecompressable())).rejects.toBeInstanceOf(
        OtlpBodyUnreadableError,
      );
    });

    it("answers 400 and attributes it to the sender", async () => {
      await expect(readOtlpBody(undecompressable())).rejects.toMatchObject({
        code: "ERR_BODY_UNREADABLE",
        httpStatus: 400,
        fault: "customer",
      });
    });

    it("still reads a well-formed compressed body", async () => {
      const payload = Buffer.from("hello");
      const req = requestWithStream(streamOf(gzipSync(payload)), {
        headers: { "content-encoding": "gzip" },
      });

      const body = await readOtlpBody(req);
      expect(Buffer.from(body).toString()).toBe("hello");
    });
  });
});
