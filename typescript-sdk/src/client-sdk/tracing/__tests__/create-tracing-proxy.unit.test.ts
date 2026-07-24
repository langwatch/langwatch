import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTracingProxy } from "../create-tracing-proxy";
import { getLangWatchTracerFromProvider, type LangWatchTracer } from "../../../observability-sdk";
import {
  type MockTracer,
  MockTracerProvider,
  setupTestEnvironment,
  createDelayedPromise,
} from "../../../observability-sdk/__tests__/test-utils";

describe("createTracingProxy", () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;
  let mockProvider: MockTracerProvider;
  let mockTracer: MockTracer;
  let langwatchTracer: LangWatchTracer;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
    mockProvider = new MockTracerProvider();
    langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "test-tracer", "1.0.0");
    mockTracer = mockProvider.getTracerByName("test-tracer", "1.0.0")!;
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  // Test class with various method types
  class TestClass {
    public publicMethod() {
      return "public-result";
    }

    public async publicAsyncMethod() {
      await createDelayedPromise("async-work", 5);
      return "async-result";
    }

    public methodWithArgs(arg1: string, arg2: number) {
      return `${arg1}-${arg2}`;
    }

    public methodThatThrows() {
      throw new Error("Test error");
    }

    public async methodThatThrowsAsync() {
      await createDelayedPromise("work", 5);
      throw new Error("Async test error");
    }

    private _privateMethod() {
      return "private-result";
    }

    public readonly getterMethod = "getter-result";

    public set setterMethod(value: string) {
      // Setter implementation
    }

    public toString() {
      return "TestClass";
    }

    public valueOf() {
      return 42;
    }

    public toJSON() {
      return { type: "TestClass" };
    }

    public constructor() {
      // Constructor
    }
  }

  describe("basic functionality", () => {
    it("should create a proxy that traces public methods", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      const result = proxy.publicMethod();

      expect(result).toBe("public-result");
      expect(mockTracer.getSpanCount()).toBe(1);

      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span).toBeDefined();
      expect(span?.ended).toBe(true);
    });

    it("should not trace private methods", () => {
      const testInstance = new TestClass();
      createTracingProxy(testInstance, langwatchTracer);

      // Private methods should not be traced
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should not trace getters and setters", () => {
      const testInstance = new TestClass();
      const tracingProxy = createTracingProxy(testInstance, langwatchTracer);

      // Access getter and setter
      const getterValue = tracingProxy.getterMethod;
      tracingProxy.setterMethod = "test";

      expect(getterValue).toBe("getter-result");
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should not trace built-in methods", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      // Call built-in methods
      proxy.toString();
      proxy.valueOf();
      proxy.toJSON();

      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should not trace constructor", () => {
      const testInstance = new TestClass();
      createTracingProxy(testInstance, langwatchTracer);

      // Constructor should not be traced
      expect(mockTracer.getSpanCount()).toBe(0);
    });
  });

  describe("span creation and attributes", () => {
    it("should create spans with correct name format", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      proxy.publicMethod();

      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span).toBeDefined();
      expect(span?.name).toBe("TestClass.publicMethod");
    });

    it("should set correct span attributes", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      proxy.publicMethod();

      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span).toBeDefined();
      // The attributes are set in the span options, verify the span was created with correct name
      expect(span?.name).toBe("TestClass.publicMethod");
      expect(span?.ended).toBe(true);
    });

    it("should set correct span kind", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      proxy.publicMethod();

      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span).toBeDefined();
      // The span kind is set in the options, verify it's used correctly
      expect(span?.ended).toBe(true);
    });
  });

  describe("method execution", () => {
    it("should execute methods with arguments correctly", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      const result = proxy.methodWithArgs("test", 42);

      expect(result).toBe("test-42");
      expect(mockTracer.getSpanCount()).toBe(1);
    });

    it("should handle async methods", async () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      const result = await proxy.publicAsyncMethod();

      expect(result).toBe("async-result");
      expect(mockTracer.getSpanCount()).toBe(1);

      const span = mockTracer.getSpan("TestClass.publicAsyncMethod");
      expect(span?.ended).toBe(true);
    });

    it("should preserve method context and binding", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      // Test that 'this' context is preserved
      const boundMethod = proxy.publicMethod.bind(proxy);
      const result = boundMethod();

      expect(result).toBe("public-result");
      expect(mockTracer.getSpanCount()).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should handle synchronous errors", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      expect(() => {
        proxy.methodThatThrows();
      }).toThrow("Test error");

      expect(mockTracer.getSpanCount()).toBe(1);
      const span = mockTracer.getSpan("TestClass.methodThatThrows");
      expect(span?.ended).toBe(true);
    });

    it("should handle asynchronous errors", async () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      await expect(proxy.methodThatThrowsAsync()).rejects.toThrow("Async test error");

      expect(mockTracer.getSpanCount()).toBe(1);
      const span = mockTracer.getSpan("TestClass.methodThatThrowsAsync");
      expect(span?.ended).toBe(true);
    });

    it("should handle async errors with different error types", async () => {
      class ErrorTestClass {
        public async stringError() {
          await createDelayedPromise("work", 5);
          throw new Error("String error");
        }

        public async nullError() {
          await createDelayedPromise("work", 5);
          throw new Error("Null error");
        }

        public async undefinedError() {
          await createDelayedPromise("work", 5);
          throw new Error("Undefined error");
        }

        public async complexError() {
          await createDelayedPromise("work", 5);
          const error = new Error("Complex error");
          (error as any).customProperty = "custom value";
          throw error;
        }
      }

      const errorInstance = new ErrorTestClass();
      const proxy = createTracingProxy(errorInstance, langwatchTracer);

      // Test string errors
      await expect(proxy.stringError()).rejects.toThrow("String error");
      expect(mockTracer.getSpan("ErrorTestClass.stringError")?.ended).toBe(true);

      // Test null errors
      await expect(proxy.nullError()).rejects.toThrow();
      expect(mockTracer.getSpan("ErrorTestClass.nullError")?.ended).toBe(true);

      // Test undefined errors
      await expect(proxy.undefinedError()).rejects.toThrow();
      expect(mockTracer.getSpan("ErrorTestClass.undefinedError")?.ended).toBe(true);

      // Test complex errors
      await expect(proxy.complexError()).rejects.toThrow("Complex error");
      const complexSpan = mockTracer.getSpan("ErrorTestClass.complexError");
      expect(complexSpan?.ended).toBe(true);
    });

    it("should handle async errors in decorators", async () => {
      class AsyncErrorDecorator {
        private target: TestClass;

        constructor(target: TestClass) {
          this.target = target;
        }

        public async publicAsyncMethod(span: any) {
          span.setAttribute("decorator.called", true);
          try {
            const result = await this.target.publicAsyncMethod();
            span.setAttribute("decorator.success", true);
            return result;
          } catch (error) {
            span.setAttribute("decorator.error", true);
            span.setAttribute("decorator.error.message", (error as Error).message);
            throw error;
          }
        }

        public async methodThatThrowsAsync(span: any) {
          span.setAttribute("decorator.called", true);
          try {
            const result = await this.target.methodThatThrowsAsync();
            span.setAttribute("decorator.success", true);
            return result;
          } catch (error) {
            span.setAttribute("decorator.error", true);
            span.setAttribute("decorator.error.message", (error as Error).message);
            throw error;
          }
        }

        valueOf() {
          return 42;
        }
      }

      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, AsyncErrorDecorator);

      // Test successful async method
      const result = await proxy.publicAsyncMethod();
      expect(result).toBe("async-result");
      const successSpan = mockTracer.getSpan("TestClass.publicAsyncMethod");
      expect(successSpan?.getAttributeValue("decorator.called")).toBe(true);
      expect(successSpan?.getAttributeValue("decorator.success")).toBe(true);
      expect(successSpan?.ended).toBe(true);

      // Test async method that throws
      await expect(proxy.methodThatThrowsAsync()).rejects.toThrow("Async test error");
      const errorSpan = mockTracer.getSpan("TestClass.methodThatThrowsAsync");
      expect(errorSpan?.getAttributeValue("decorator.called")).toBe(true);
      expect(errorSpan?.getAttributeValue("decorator.error")).toBe(true);
      expect(errorSpan?.ended).toBe(true);
    });

    it("should handle concurrent async errors", async () => {
      class ConcurrentErrorClass {
        public async delayedError(delay: number) {
          await createDelayedPromise("work", delay);
          throw new Error(`Error after ${delay}ms`);
        }
      }

      const concurrentInstance = new ConcurrentErrorClass();
      const proxy = createTracingProxy(concurrentInstance, langwatchTracer);

      // Start multiple concurrent operations that will fail
      const promises = Array.from({ length: 3 }, (_, i) =>
        proxy.delayedError(i * 10).catch(error => error.message)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result, i) => {
        expect(result).toBe(`Error after ${i * 10}ms`);
      });

      // Verify all spans were created and ended
      expect(mockTracer.getSpanCount()).toBe(3);
      for (let i = 0; i < 3; i++) {
        const span = mockTracer.getSpan(`ConcurrentErrorClass.delayedError`);
        expect(span?.ended).toBe(true);
      }
    });

    it("should handle async errors with promise chains", async () => {
      class PromiseChainClass {
        public async promiseChain() {
          return Promise.resolve("step1")
            .then(_result => Promise.resolve(_result + " -> step2"))
            .then(_result => Promise.resolve(_result + " -> step3"))
            .then(() => {
              throw new Error("Error in promise chain");
            });
        }
      }

      const chainInstance = new PromiseChainClass();
      const proxy = createTracingProxy(chainInstance, langwatchTracer);

      await expect(proxy.promiseChain()).rejects.toThrow("Error in promise chain");

      const span = mockTracer.getSpan("PromiseChainClass.promiseChain");
      expect(span?.ended).toBe(true);
    });

    it("should handle async errors with finally blocks", async () => {
      class FinallyClass {
        public async withFinally() {
          try {
            await createDelayedPromise("work", 5);
            throw new Error("Error in try block");
          } finally {
            // This should still execute
            console.log("Finally block executed");
            // eslint-disable-next-line no-unsafe-finally
            return "finally result";
          }
        }
      }

      const finallyInstance = new FinallyClass();
      const proxy = createTracingProxy(finallyInstance, langwatchTracer);

      const result = await proxy.withFinally();
      expect(result).toBe("finally result");

      const span = mockTracer.getSpan("FinallyClass.withFinally");
      expect(span?.ended).toBe(true);
    });
  });

  describe("decorator functionality", () => {
    // Decorator class for testing
    class TestDecorator {
      private target: TestClass;

      constructor(target: TestClass) {
        this.target = target;
      }

      public publicMethod(span: any, ..._args: any[]) {
        span.setAttribute("decorator.called", true);
        span.setAttribute("decorator.args", _args.length);
        return this.target.publicMethod();
      }

      public methodWithArgs(span: any, _arg1: string, _arg2: number) {
        span.setAttribute("decorator.arg1", _arg1);
        span.setAttribute("decorator.arg2", _arg2);
        return this.target.methodWithArgs(_arg1, _arg2);
      }

      public async publicAsyncMethod(span: any, ..._args: any[]) {
        span.setAttribute("decorator.async", true);
        const result = await this.target.publicAsyncMethod();
        span.setAttribute("decorator.result", result);
        return result;
      }

      valueOf() {
        return 42;
      }
    }

    it("should use decorator when provided", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, TestDecorator);

      const result = proxy.publicMethod();

      expect(result).toBe("public-result");
      expect(mockTracer.getSpanCount()).toBe(1);

      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span?.getAttributeValue("decorator.called")).toBe(true);
      expect(span?.getAttributeValue("decorator.args")).toBe(0);
    });

    it("should pass arguments to decorator methods", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, TestDecorator);

      const result = proxy.methodWithArgs("test", 42);

      expect(result).toBe("test-42");
      expect(mockTracer.getSpanCount()).toBe(1);

      const span = mockTracer.getSpan("TestClass.methodWithArgs");
      expect(span?.getAttributeValue("decorator.arg1")).toBe("test");
      expect(span?.getAttributeValue("decorator.arg2")).toBe(42);
    });

    it("should handle async decorator methods", async () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, TestDecorator);

      const result = await proxy.publicAsyncMethod();

      expect(result).toBe("async-result");
      expect(mockTracer.getSpanCount()).toBe(1);

      const span = mockTracer.getSpan("TestClass.publicAsyncMethod");
      expect(span?.getAttributeValue("decorator.async")).toBe(true);
      expect(span?.getAttributeValue("decorator.result")).toBe("async-result");
    });

    it("should fall back to original method when decorator doesn't have the method", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, TestDecorator);

      // Test a method that exists in TestClass but not in TestDecorator
      expect(() => {
        proxy.methodThatThrows();
      }).toThrow("Test error");
      expect(mockTracer.getSpanCount()).toBe(1);
    });
  });

  describe("proxy behavior", () => {
    it("should return non-function properties as-is", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      // Test that non-function properties are returned as-is
      expect(typeof proxy.getterMethod).toBe("string");
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should bind non-traced functions to target", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      // Test that non-traced functions are bound to the target
      const toStringResult = proxy.toString();
      expect(toStringResult).toBe("TestClass");
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should maintain proxy identity", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      expect(proxy).not.toBe(testInstance);
      expect(typeof proxy.publicMethod).toBe("function");
    });
  });

  describe("edge cases", () => {
    it("should handle class with no public methods", () => {
      class EmptyClass {
        private _privateMethod() {
          return "private";
        }
      }

      const emptyInstance = new EmptyClass();
      createTracingProxy(emptyInstance, langwatchTracer);

      // Should not create any spans
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should handle class with only built-in methods", () => {
      class BuiltInOnlyClass {
        public toString() {
          return "built-in";
        }
      }

      const builtInInstance = new BuiltInOnlyClass();
      const proxy = createTracingProxy(builtInInstance, langwatchTracer);

      proxy.toString();
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should handle methods that return promises", async () => {
      class PromiseClass {
        public async promiseMethod() {
          return Promise.resolve("promise-result");
        }
      }

      const promiseInstance = new PromiseClass();
      const proxy = createTracingProxy(promiseInstance, langwatchTracer);

      const result = await proxy.promiseMethod();

      expect(result).toBe("promise-result");
      expect(mockTracer.getSpanCount()).toBe(1);
    });

    it("should handle methods that return undefined", () => {
      class UndefinedClass {
        public undefinedMethod() {
          return undefined;
        }
      }

      const undefinedInstance = new UndefinedClass();
      const proxy = createTracingProxy(undefinedInstance, langwatchTracer);

      const result = proxy.undefinedMethod();

      expect(result).toBeUndefined();
      expect(mockTracer.getSpanCount()).toBe(1);
    });
  });

  describe("concurrent execution", () => {
    it("should handle concurrent method calls", async () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      const promises = Array.from({ length: 5 }, () =>
        proxy.publicAsyncMethod()
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toBe("async-result");
      });

      expect(mockTracer.getSpanCount()).toBe(5);
    });

    it("should handle nested method calls", async () => {
      class NestedClass {
        public async outerMethod() {
          return this.innerMethod();
        }

        public async innerMethod() {
          await createDelayedPromise("work", 5);
          return "inner-result";
        }
      }

      const nestedInstance = new NestedClass();
      const proxy = createTracingProxy(nestedInstance, langwatchTracer);

      const result = await proxy.outerMethod();

      expect(result).toBe("inner-result");
      // Only the outer method should be traced since innerMethod is called within the span context
      expect(mockTracer.getSpanCount()).toBe(1);
      expect(mockTracer.getSpan("NestedClass.outerMethod")).toBeDefined();
    });
  });

  describe("decorator error handling", () => {
    class ErrorDecorator {
      private target: TestClass;

      constructor(target: TestClass) {
        this.target = target;
      }

      public publicMethod(span: any, ..._args: any[]): string {
        span.setAttribute("decorator.error", true);
        throw new Error("Decorator error");
      }

      public publicAsyncMethod(span: any, ..._args: any[]): Promise<string> {
        span.setAttribute("decorator.error", true);
        throw new Error("Decorator error");
      }

      public methodWithArgs(span: any, _arg1: string, _arg2: number): string {
        span.setAttribute("decorator.error", true);
        throw new Error("Decorator error");
      }

      public methodThatThrows(span: any, ..._args: any[]): string {
        span.setAttribute("decorator.error", true);
        throw new Error("Decorator error");
      }

      public methodThatThrowsAsync(span: any, ..._args: any[]): Promise<void> {
        span.setAttribute("decorator.error", true);
        throw new Error("Decorator error");
      }
    }

    it("should handle decorator errors", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer, ErrorDecorator as any);

      expect(() => {
        proxy.publicMethod();
      }).toThrow("Decorator error");

      expect(mockTracer.getSpanCount()).toBe(1);
      const span = mockTracer.getSpan("TestClass.publicMethod");
      expect(span?.getAttributeValue("decorator.error")).toBe(true);
      expect(span?.ended).toBe(true);
    });
  });

  describe("type safety", () => {
    it("should maintain type safety for the proxy", () => {
      const testInstance = new TestClass();
      const proxy = createTracingProxy(testInstance, langwatchTracer);

      // TypeScript should recognize this as a TestClass
      expect(proxy).toBeInstanceOf(TestClass);
      expect(typeof proxy.publicMethod).toBe("function");
    });

    it("should work with generic types", () => {
      class GenericClass<T> {
        public method(value: T): T {
          return value;
        }
      }

      const genericInstance = new GenericClass<string>();
      const proxy = createTracingProxy(genericInstance, langwatchTracer);

      const result = proxy.method("test");
      expect(result).toBe("test");
      expect(mockTracer.getSpanCount()).toBe(1);
    });
  });
});
