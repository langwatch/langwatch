import { describe, expect, it } from "vitest";

import { readableByteStream } from "../byte-stream.ts";

describe("given the REST byte stream adapter", () => {
  it("delivers source failures and closes the iterator", async () => {
    const failure = new Error("upstream failed");
    let closed = false;

    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw failure;
          },
          return: async () => {
            closed = true;

            return { done: true, value: void 0 };
          },
        };
      },
    };

    const reader = readableByteStream(source).getReader();

    await expect(reader.read()).rejects.toBe(failure);
    expect(closed).toBe(true);
  });

  it("cancels upstream even when the cancellation hook fails", async () => {
    const failure = new Error("release failed");
    let cancellation: unknown;

    const source = new ReadableStream<Uint8Array>({
      cancel(reason: unknown) {
        cancellation = reason;
      },
    });

    const stream = readableByteStream(source, async () => {
      throw failure;
    });

    await expect(stream.cancel("client disconnected")).rejects.toBe(failure);
    expect(cancellation).toBe("client disconnected");
    expect(source.locked).toBe(false);
  });

  it("runs the cancellation hook before returning a source awaiting more data", async () => {
    let unblock: () => void = () => {};

    const pending = new Promise<void>((resolve) => {
      unblock = resolve;
    });

    let closed = false;

    async function* source() {
      try {
        await pending;
        yield new Uint8Array([1]);
      } finally {
        closed = true;
      }
    }

    const stream = readableByteStream(source(), () => {
      unblock();
    });

    const reader = stream.getReader();
    const reading = reader.read();

    await reader.cancel();
    await expect(reading).resolves.toEqual({ done: true, value: void 0 });
    expect(closed).toBe(true);
  });

  it("releases a wrapped Web stream reader after normal completion", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([65]));
        controller.close();
      },
    });

    let cancelled = false;

    const stream = readableByteStream(source, () => {
      cancelled = true;
    });

    await expect(new Response(stream).text()).resolves.toBe("A");
    expect(source.locked).toBe(false);
    expect(cancelled).toBe(false);
  });
});
