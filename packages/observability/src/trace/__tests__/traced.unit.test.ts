/**
 * @vitest-environment node
 *
 * Runs `traced()` against a REAL TracerProvider rather than a stubbed tracer,
 * so what these tests assert is the span the proxy actually produces and the
 * value it actually hands back. A stub can be made to agree with a wrapper that
 * is wrong.
 */
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { traced } from "../traced";

class ExampleService {
  getterReads = 0;

  async fetchOne(): Promise<string> {
    return "one";
  }

  /**
   * A method that returns a promise without being declared `async`. A wrapper
   * that trusts `constructor.name === "AsyncFunction"` reads this as
   * synchronous and leaves it without a span.
   */
  fetchLater(): Promise<string> {
    return new Promise((resolve) => setTimeout(() => resolve("later"), 5));
  }

  /** The clock helper shape: a plain number every caller does arithmetic on. */
  now(): number {
    return 1_700_000_000_000;
  }

  /** The cache-key shape: a plain string every caller interpolates. */
  label(): string {
    return "example";
  }

  explode(): string {
    throw new Error("sync boom");
  }

  /**
   * Reaches both helpers through `this`, which for a traced service is the
   * proxy, so this is the call shape that decides whether the helpers answer
   * with their value or with a promise of it.
   */
  async describe(): Promise<{ key: string; ageMs: number; fresh: boolean }> {
    return {
      key: `cache:${this.label()}:${this.now()}`,
      ageMs: this.now() - 1_699_999_999_000,
      fresh: this.now() > 1_699_999_999_000,
    };
  }

  get configured(): boolean {
    this.getterReads += 1;
    return true;
  }

  /**
   * Wrapping this in `withActiveSpan(name, async () => fn())` returns a
   * Promise<AsyncGenerator>, which is not async-iterable, so `for await` throws
   * "not async iterable" at call time.
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

  *countUp(): Generator<number> {
    yield 1;
    yield 2;
    yield 3;
  }
}

describe("traced()", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  afterEach(() => {
    exporter.reset();
  });

  const service = () => traced(new ExampleService(), "ExampleService");
  const spanNames = () => exporter.getFinishedSpans().map((s) => s.name);
  const spanNamed = (name: string): ReadableSpan | undefined =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  describe("when the method is synchronous", () => {
    /** @scenario A synchronous helper answers with its value */
    it("hands back the value itself rather than a promise of it", () => {
      const returned = service().now();

      expect(returned).toBe(1_700_000_000_000);
      expect(returned).not.toBeInstanceOf(Promise);
    });

    it("keeps a string usable in a template", () => {
      expect(`cache:${service().label()}`).toBe("cache:example");
    });

    it("still records a span for the call", () => {
      service().now();

      expect(spanNames()).toContain("ExampleService.now");
    });
  });

  describe("when a synchronous method throws", () => {
    /** @scenario A synchronous helper that fails reaches its caller */
    it("throws to the caller synchronously", () => {
      expect(() => service().explode()).toThrow("sync boom");
    });

    it("ends the span and marks it errored", () => {
      expect(() => service().explode()).toThrow("sync boom");

      const span = spanNamed("ExampleService.explode");
      expect(span).toBeDefined();
      expect(span!.status.code).toBe(SpanStatusCode.ERROR);
      expect(span!.events.map((e) => e.name)).toContain("exception");
    });
  });

  /**
   * The bug class this guards: every internal call goes through the proxy,
   * because the proxy is what `this` is bound to. A helper that answers with a
   * promise where the caller reads a value fails silently: arithmetic goes NaN,
   * interpolation writes "[object Promise]", comparisons go false, and it only
   * surfaces as wrong behavior somewhere else entirely.
   */
  describe("when a traced method reaches a synchronous helper through this", () => {
    /** @scenario A service reading its own helper sees real values */
    it("reads the helper's real value", async () => {
      await expect(service().describe()).resolves.toEqual({
        key: "cache:example:1700000000000",
        ageMs: 1_000,
        fresh: true,
      });
    });

    it("interpolates a string rather than [object Promise]", async () => {
      const { key } = await service().describe();

      expect(key).not.toContain("[object Promise]");
    });

    it("computes a number rather than NaN", async () => {
      const { ageMs } = await service().describe();

      expect(Number.isNaN(ageMs)).toBe(false);
    });

    it("spans the helper calls as well as the method", async () => {
      await service().describe();

      expect(spanNames()).toContain("ExampleService.describe");
      expect(spanNames()).toContain("ExampleService.now");
      expect(spanNames()).toContain("ExampleService.label");
    });
  });

  describe("when the method is a normal async function", () => {
    it("still resolves its value", async () => {
      await expect(service().fetchOne()).resolves.toBe("one");
    });

    it("records a span for the call", async () => {
      await service().fetchOne();

      expect(spanNames()).toContain("ExampleService.fetchOne");
    });
  });

  describe("when the method returns a promise without being declared async", () => {
    it("resolves its value", async () => {
      await expect(service().fetchLater()).resolves.toBe("later");
    });

    /** @scenario A method that answers with a promise is timed until it settles */
    it("holds the span open until the promise settles", async () => {
      const pending = service().fetchLater();
      expect(spanNames()).not.toContain("ExampleService.fetchLater");

      await pending;

      expect(spanNames()).toContain("ExampleService.fetchLater");
    });
  });

  describe("when the property is a getter", () => {
    it("returns its value and reads it exactly once", () => {
      const instance = new ExampleService();
      const wrapped = traced(instance, "ExampleService");

      expect(wrapped.configured).toBe(true);
      expect(instance.getterReads).toBe(1);
    });
  });

  describe("when the service is awaited", () => {
    it("is not mistaken for a thenable", async () => {
      const wrapped = service() as unknown as Record<string, unknown>;

      expect(wrapped.then).toBeUndefined();
      await expect(Promise.resolve(wrapped)).resolves.toBe(wrapped);
    });
  });

  describe("when the method is a synchronous generator", () => {
    it("returns something iterable rather than a promise", () => {
      expect([...service().countUp()]).toEqual([1, 2, 3]);
    });
  });

  describe("when the method is an async generator", () => {
    it("returns something async-iterable rather than a promise", () => {
      const returned = service().stream(1) as unknown as Record<symbol, unknown>;

      expect(returned[Symbol.asyncIterator]).toBeTypeOf("function");
      expect(returned).not.toBeInstanceOf(Promise);
    });

    it("yields every value in order", async () => {
      const seen: number[] = [];
      for await (const value of service().stream(4)) {
        seen.push(value);
      }

      expect(seen).toEqual([0, 1, 2, 3]);
    });

    it("propagates a throw from inside the generator", async () => {
      const wrapped = service();
      const consume = async () => {
        for await (const _ of wrapped.streamThatThrows()) {
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
    /** @scenario A streaming method stays iterable */
    it("opens a span named for the method and closes it when drained", async () => {
      for await (const _ of service().stream(3)) {
        // drain
      }

      expect(spanNames()).toEqual(["ExampleService.stream"]);
    });

    it("closes the span and marks it errored when the generator throws", async () => {
      const wrapped = service();

      await expect(
        (async () => {
          for await (const _ of wrapped.streamThatThrows()) {
            // drain
          }
        })(),
      ).rejects.toThrow("boom");

      expect(spanNamed("ExampleService.streamThatThrows")?.status.code).toBe(SpanStatusCode.ERROR);
    });

    /**
     * A cancelled export breaks out of the `for await`, which calls the
     * generator's `return()`. Without the `finally` the span would stay open
     * for the life of the process.
     */
    it("closes the span when the consumer abandons the loop", async () => {
      for await (const _ of service().stream(10)) {
        break;
      }

      expect(spanNamed("ExampleService.stream")).toBeDefined();
    });
  });
});
