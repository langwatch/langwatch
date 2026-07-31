import { describe, expect, it, vi } from "vitest";

const startSpan = vi.hoisted(() => vi.fn());
const spans = vi.hoisted(
  () => [] as { name: string; ended: boolean; errored: boolean }[],
);

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, fn: () => unknown) => fn(),
    startSpan: (name: string) => {
      const record = { name, ended: false, errored: false };
      spans.push(record);
      startSpan(name);
      return {
        end: () => {
          record.ended = true;
        },
        recordException: () => undefined,
        setStatus: () => {
          record.errored = true;
        },
      };
    },
  }),
}));

import { traced } from "../tracing";

class ExampleService {
  async fetchOne(): Promise<string> {
    return "one";
  }

  /**
   * The case that regressed: wrapping this in `withActiveSpan(name, async () =>
   * fn())` returns a Promise<AsyncGenerator>, which is not async-iterable, so
   * `for await` throws "not async iterable" at call time.
   */
  async *stream(count: number): AsyncGenerator<number> {
    for (let i = 0; i < count; i++) {
      yield i;
    }
  }

  async *streamThatThrows(): AsyncGenerator<number> {
    yield 1;
    throw new Error("boom");
  }
}

describe("traced()", () => {
  describe("when the method is a normal async function", () => {
    it("still resolves its value", async () => {
      const service = traced(new ExampleService(), "ExampleService");
      await expect(service.fetchOne()).resolves.toBe("one");
    });
  });

  describe("when the method is an async generator", () => {
    it("returns something async-iterable rather than a promise", () => {
      const service = traced(new ExampleService(), "ExampleService");
      const returned = service.stream(1) as unknown as Record<symbol, unknown>;

      expect(returned[Symbol.asyncIterator]).toBeTypeOf("function");
      expect(returned).not.toBeInstanceOf(Promise);
    });

    it("yields every value in order", async () => {
      const service = traced(new ExampleService(), "ExampleService");

      const seen: number[] = [];
      for await (const value of service.stream(4)) {
        seen.push(value);
      }

      expect(seen).toEqual([0, 1, 2, 3]);
    });

    it("propagates a throw from inside the generator", async () => {
      const service = traced(new ExampleService(), "ExampleService");

      const consume = async () => {
        for await (const _ of service.streamThatThrows()) {
          // drain
        }
      };

      await expect(consume()).rejects.toThrow("boom");
    });

    /**
     * The delegation alone left these methods with no span at all — the class
     * looked traced and produced nothing, which is worse than not wrapping it,
     * because the gap only shows up when someone goes looking for the trace.
     */
    it("opens a span named for the method and closes it when drained", async () => {
      spans.length = 0;
      const service = traced(new ExampleService(), "ExampleService");

      for await (const _ of service.stream(3)) {
        // drain
      }

      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe("ExampleService.stream");
      expect(spans[0]!.ended).toBe(true);
    });

    it("closes the span and marks it errored when the generator throws", async () => {
      spans.length = 0;
      const service = traced(new ExampleService(), "ExampleService");

      await expect(
        (async () => {
          for await (const _ of service.streamThatThrows()) {
            // drain
          }
        })(),
      ).rejects.toThrow("boom");

      expect(spans[0]!.ended).toBe(true);
      expect(spans[0]!.errored).toBe(true);
    });

    /**
     * A cancelled export breaks out of the `for await`, which calls the
     * generator's `return()`. Without the `finally` the span would stay open
     * for the life of the process.
     */
    it("closes the span when the consumer abandons the loop", async () => {
      spans.length = 0;
      const service = traced(new ExampleService(), "ExampleService");

      for await (const _ of service.stream(10)) {
        break;
      }

      expect(spans[0]!.ended).toBe(true);
    });
  });
});
