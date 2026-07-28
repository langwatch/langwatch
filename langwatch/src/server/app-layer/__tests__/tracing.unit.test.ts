import { describe, expect, it } from "vitest";
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
  });
});
