import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { createTracingProxy } from "../../create-tracing-proxy";
import { getLangWatchTracer } from "../../../../observability-sdk";
import { NoOpLogger } from "../../../../logger";
import { setupObservability } from "../../../../observability-sdk/setup/node";

/**
 * Integration tests for createTracingProxy with real OpenTelemetry setup.
 *
 * These tests verify:
 * - Real OpenTelemetry SDK initialization
 * - Actual span creation and data flow through proxy
 * - Integration between proxy and tracer components
 * - Data format consistency in exported spans
 */

describe("createTracingProxy Integration Tests", () => {
  let spanExporter: InMemorySpanExporter;
  let spanProcessor: SimpleSpanProcessor;
  let observabilityHandle: Awaited<ReturnType<typeof setupObservability>>;
  let tracer: ReturnType<typeof getLangWatchTracer>;

  beforeEach(async () => {
    // Reset OpenTelemetry global state
    vi.resetModules();

    // Create in-memory exporter to capture actual span data
    spanExporter = new InMemorySpanExporter();
    spanProcessor = new SimpleSpanProcessor(spanExporter);

    // Setup observability with real OpenTelemetry SDK
    observabilityHandle = setupObservability({
      serviceName: "tracing-proxy-integration-test",
      spanProcessors: [spanProcessor],
      debug: { logger: new NoOpLogger() },
      advanced: {
        throwOnSetupError: true,
      },
      attributes: {
        "test.suite": "tracing-proxy-integration",
        "test.environment": "vitest"
      },
    });

    // Get tracer using the configured provider
    tracer = getLangWatchTracer("tracing-proxy-test");
  });

  afterEach(async () => {
    await observabilityHandle.shutdown();
    spanExporter.reset();
    trace.disable();
  });

  describe("basic functionality", () => {
    it("should create a proxy that traces public methods", async () => {
      class TestClass {
        publicMethod() {
          return 'public result';
        }

        private _privateMethod() {
          return 'private result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();

      expect(result).toBe('public result');

      // Flush and verify exported spans
      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);

      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
      expect(span.attributes["code.function"]).toBe("publicMethod");
      expect(span.attributes["code.namespace"]).toBe("TestClass");
    });

    it("should not trace private methods", async () => {
      class TestClass {
        publicMethod() {
          return 'public result';
        }

        private _privateMethod() {
          return 'private result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      // Private methods should not be traced but should still be callable
      expect(typeof (proxy as any)._privateMethod).toBe('function');

      // Call a public method to ensure tracing works
      proxy.publicMethod();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should only have one span for the public method
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should not trace built-in methods", async () => {
      class TestClass {
        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      // These should not trigger tracing
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      proxy.toString();
      proxy.valueOf();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have no spans for built-in methods
      expect(exportedSpans).toHaveLength(0);
    });

    it("should handle non-function properties", async () => {
      class TestClass {
        public property = 'test value';

        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.property).toBe('test value');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have no spans for property access
      expect(exportedSpans).toHaveLength(0);
    });
  });

  describe("decorator functionality", () => {
    it("should use decorator methods when available", async () => {
      class TestClass {
        publicMethod() {
          return 'original result';
        }
      }

      class TestDecorator {
        constructor(private target: TestClass) {}

        publicMethod() {
          return 'decorated result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer, TestDecorator as any);

      const result = proxy.publicMethod();

      expect(result).toBe('decorated result');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
      expect(span.attributes["code.function"]).toBe("publicMethod");
      expect(span.attributes["code.namespace"]).toBe("TestClass");
    });

    it("should fall back to original method when decorator method is not available", async () => {
      class TestClass {
        publicMethod() {
          return 'original result';
        }
      }

      class TestDecorator {
        constructor(private target: TestClass) {}
        // No publicMethod defined in decorator
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer, TestDecorator as any);

      const result = proxy.publicMethod();

      expect(result).toBe('original result');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });

    it("should handle decorator methods that are not functions", async () => {
      class TestClass {
        publicMethod() {
          return 'original result';
        }
      }

      class TestDecorator {
        constructor(private target: TestClass) {}

        publicMethod = 'not a function';
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer, TestDecorator as any);

      const result = proxy.publicMethod();

      expect(result).toBe('original result');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe("method arguments and return values", () => {
    it("should pass arguments correctly to traced methods", async () => {
      class TestClass {
        publicMethod(arg1: string, arg2: number) {
          return `${arg1}-${arg2}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod('test', 42);

      expect(result).toBe('test-42');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });

    it("should handle async methods", async () => {
      class TestClass {
        async publicMethod() {
          return 'async result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = await proxy.publicMethod();

      expect(result).toBe('async result');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });

    it("should handle methods that throw errors", async () => {
      class TestClass {
        publicMethod() {
          throw new Error('test error');
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(() => proxy.publicMethod()).toThrow('test error');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.status.message).toBe("test error");
    });

    it("should handle async methods that throw errors", async () => {
      class TestClass {
        async publicMethod() {
          throw new Error('async error');
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      await expect(proxy.publicMethod()).rejects.toThrow('async error');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.status.message).toBe("async error");
    });
  });

  describe("decorator span access", () => {
    it("should call decorator method with correct context", async () => {
      class TestClass {
        publicMethod() {
          return 'original result';
        }
      }

      let decoratorCalled = false;
      class TestDecorator {
        constructor(private target: TestClass) {}

        publicMethod() {
          decoratorCalled = true;
          return 'decorated result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer, TestDecorator as any);

      const result = proxy.publicMethod();

      expect(result).toBe('decorated result');
      expect(decoratorCalled).toBe(true);

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      const span = exportedSpans[0];
      if (!span) {
        throw new Error("Expected span to be exported");
      }

      expect(span.name).toBe("TestClass.publicMethod");
      expect(span.status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe("span lifecycle", () => {
    it("should handle multiple method calls", async () => {
      class TestClass {
        method1() {
          return 'result1';
        }
        method2() {
          return 'result2';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      proxy.method1();
      proxy.method2();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(2);

      const method1Span = exportedSpans.find(s => s.name === "TestClass.method1");
      const method2Span = exportedSpans.find(s => s.name === "TestClass.method2");

      expect(method1Span).toBeDefined();
      expect(method2Span).toBeDefined();
      expect(method1Span?.status.code).toBe(SpanStatusCode.OK);
      expect(method2Span?.status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe("method filtering", () => {
    it("should not trace getters", async () => {
      class TestClass {
        // eslint-disable-next-line @typescript-eslint/class-literal-property-style
        get getterProperty() {
          return 'getter value';
        }

        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.getterProperty).toBe('getter value');

      // Call a public method to ensure tracing works
      proxy.publicMethod();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should only have one span for the public method
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should not trace setters", async () => {
      class TestClass {
        private _value = '';

        set setterProperty(value: string) {
          this._value = value;
        }

        get getterProperty() {
          return this._value;
        }

        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      proxy.setterProperty = 'test value';
      expect(proxy.getterProperty).toBe('test value');

      // Call a public method to ensure tracing works
      proxy.publicMethod();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should only have one span for the public method
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });
  });

  describe("edge cases", () => {
    it("should handle target with no methods", async () => {
      class EmptyClass {}

      const target = new EmptyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy).toBeDefined();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have no spans
      expect(exportedSpans).toHaveLength(0);
    });

    it("should handle target with only private methods", async () => {
      class PrivateOnlyClass {
        private _privateMethod() {
          return 'private';
        }
      }

      const target = new PrivateOnlyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy).toBeDefined();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have no spans
      expect(exportedSpans).toHaveLength(0);
    });

    it("should handle target with only built-in methods", async () => {
      class BuiltInOnlyClass {
        toString() {
          return 'built-in';
        }
      }

      const target = new BuiltInOnlyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.toString()).toBe('built-in');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should have no spans for built-in methods
      expect(exportedSpans).toHaveLength(0);
    });

    it("should handle symbol properties", async () => {
      const symbol = Symbol('test');

      class SymbolClass {
        [symbol]() {
          return 'symbol method';
        }

        publicMethod() {
          return 'public result';
        }
      }

      const target = new SymbolClass();
      const proxy = createTracingProxy(target, tracer);

      // Symbol methods should not be traced
      expect(proxy[symbol]()).toBe('symbol method');

      // Public methods should still be traced
      proxy.publicMethod();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // Should only have one span for the public method
      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("SymbolClass.publicMethod");
    });

    it("should handle methods with special characters in names", async () => {
      class TestClass {
        'method-with-dash'() {
          return 'dash result';
        }
        'method_with_underscore'() {
          return 'underscore result';
        }
        'methodWithCamelCase'() {
          return 'camel result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy['method-with-dash']()).toBe('dash result');
      expect(proxy.method_with_underscore()).toBe('underscore result');
      expect(proxy.methodWithCamelCase()).toBe('camel result');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(3);

      const dashSpan = exportedSpans.find(s => s.name === "TestClass.method-with-dash");
      const underscoreSpan = exportedSpans.find(s => s.name === "TestClass.method_with_underscore");
      const camelSpan = exportedSpans.find(s => s.name === "TestClass.methodWithCamelCase");

      expect(dashSpan).toBeDefined();
      expect(underscoreSpan).toBeDefined();
      expect(camelSpan).toBeDefined();
    });

    it("should handle methods that return undefined", async () => {
      class TestClass {
        publicMethod() {
          // Returns undefined
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toBeUndefined();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should handle methods that return null", async () => {
      class TestClass {
        publicMethod() {
          return null;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toBeNull();

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should handle methods with complex return values", async () => {
      class TestClass {
        publicMethod() {
          return { complex: 'object', nested: { value: 42 } };
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toEqual({ complex: 'object', nested: { value: 42 } });

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should handle methods with this context", async () => {
      class TestClass {
        private value = 'test';

        publicMethod() {
          return this.value;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toBe('test');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
    });

    it("should handle methods that modify target state", async () => {
      class TestClass {
        private counter = 0;

        publicMethod() {
          this.counter++;
          return this.counter;
        }

        getCounter() {
          return this.counter;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.publicMethod()).toBe(1);
      expect(proxy.publicMethod()).toBe(2);
      expect(proxy.getCounter()).toBe(2);

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      // getCounter is also a public method, so it gets traced too
      expect(exportedSpans).toHaveLength(3);

      const methodSpans = exportedSpans.filter(s => s.name === "TestClass.publicMethod");
      const counterSpans = exportedSpans.filter(s => s.name === "TestClass.getCounter");

      expect(methodSpans).toHaveLength(2);
      expect(counterSpans).toHaveLength(1);
    });

    it("should handle methods with default parameters", async () => {
      class TestClass {
        publicMethod(param1 = 'default', param2 = 42) {
          return `${param1}-${param2}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.publicMethod()).toBe('default-42');
      expect(proxy.publicMethod('custom')).toBe('custom-42');
      expect(proxy.publicMethod('custom', 100)).toBe('custom-100');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(3);
      exportedSpans.forEach(span => {
        expect(span.name).toBe("TestClass.publicMethod");
        expect(span.status.code).toBe(SpanStatusCode.OK);
      });
    });

    it("should handle methods with rest parameters", async () => {
      class TestClass {
        publicMethod(...args: any[]) {
          return args.join('-');
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.publicMethod()).toBe('');
      expect(proxy.publicMethod('a')).toBe('a');
      expect(proxy.publicMethod('a', 'b', 'c')).toBe('a-b-c');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(3);
      exportedSpans.forEach(span => {
        expect(span.name).toBe("TestClass.publicMethod");
        expect(span.status.code).toBe(SpanStatusCode.OK);
      });
    });

    it("should handle methods with destructuring parameters", async () => {
      class TestClass {
        publicMethod({ name, age }: { name: string; age: number }) {
          return `${name}-${age}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod({ name: 'John', age: 30 });
      expect(result).toBe('John-30');

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(1);
      expect(exportedSpans[0]?.name).toBe("TestClass.publicMethod");
      expect(exportedSpans[0]?.status.code).toBe(SpanStatusCode.OK);
    });
  });

  describe("performance and concurrency", () => {
    it("should handle concurrent method calls efficiently", async () => {
      class TestClass {
        async publicMethod(index: number) {
          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return `result-${index}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const concurrentOperations = Array.from({ length: 5 }, (_, i) =>
        proxy.publicMethod(i)
      );

      const results = await Promise.all(concurrentOperations);

      expect(results).toEqual(['result-0', 'result-1', 'result-2', 'result-3', 'result-4']);

      await spanProcessor.forceFlush();
      const exportedSpans = spanExporter.getFinishedSpans();

      expect(exportedSpans).toHaveLength(5);

      // Verify all spans have unique IDs and proper attributes
      const spanIds = new Set(exportedSpans.map(s => s.spanContext().spanId));
      expect(spanIds.size).toBe(5); // All unique

      exportedSpans.forEach((span) => {
        expect(span.name).toBe("TestClass.publicMethod");
        expect(span.status.code).toBe(SpanStatusCode.OK);
        expect(span.attributes["code.function"]).toBe("publicMethod");
        expect(span.attributes["code.namespace"]).toBe("TestClass");
      });
    });
  });
});
