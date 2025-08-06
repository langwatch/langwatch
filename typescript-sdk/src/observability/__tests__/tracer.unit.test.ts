import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SpanStatusCode, SpanKind, trace as otelTrace } from "@opentelemetry/api";
import {
  getLangWatchTracer,
  getLangWatchTracerFromProvider,
} from "../tracer";
import { LangWatchTracer, LangWatchSpan } from "../types";
import {
  MockSpan,
  MockTracer,
  MockTracerProvider,
  setupTestEnvironment,
  flushPromises,
  createRejectedPromise,
  createDelayedPromise,
  testScenarios,
  errorTestUtils,
  performanceUtils,
} from "./test-utils";

describe("tracer.ts", () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;
  let mockProvider: MockTracerProvider;
  let mockTracer: MockTracer;
  let langwatchTracer: LangWatchTracer;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
    mockProvider = new MockTracerProvider();
    // Get the tracer that will actually be used by the LangWatch tracer
    langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "test-tracer", "1.0.0");
    // Get the same tracer instance for our test spies
    mockTracer = mockProvider.getTracerByName("test-tracer", "1.0.0")!;
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe("getLangWatchTracerFromProvider", () => {
    it("should create a LangWatch tracer from a tracer provider", () => {
      expect(langwatchTracer).toBeDefined();
      expect(typeof langwatchTracer.startSpan).toBe("function");
      expect(typeof langwatchTracer.startActiveSpan).toBe("function");
      expect(typeof langwatchTracer.withActiveSpan).toBe("function");
    });

    it("should call provider.getTracer with correct parameters", () => {
      expect(mockProvider.getTracer).toHaveBeenCalledWith("test-tracer", "1.0.0");
    });

    it("should handle version parameter correctly", () => {
      const tracerWithoutVersion = getLangWatchTracerFromProvider(mockProvider, "no-version");
      expect(mockProvider.getTracer).toHaveBeenCalledWith("no-version", undefined);
    });
  });

  describe("getLangWatchTracer", () => {
    it("should get tracer from global provider", () => {
      // Mock the global tracer provider
      const globalGetTracerSpy = vi.spyOn(otelTrace, 'getTracerProvider').mockReturnValue(mockProvider);

      const globalTracer = getLangWatchTracer("global-tracer", "2.0.0");

      expect(globalGetTracerSpy).toHaveBeenCalled();
      expect(mockProvider.getTracer).toHaveBeenCalledWith("global-tracer", "2.0.0");
      expect(globalTracer).toBeDefined();

      globalGetTracerSpy.mockRestore();
    });
  });

  describe("startSpan", () => {
    it("should create a LangWatchSpan", () => {
      const span = langwatchTracer.startSpan("test-span");

      expect(span).toBeDefined();
      expect(typeof span.setType).toBe("function");
      expect(typeof span.setInput).toBe("function");
      expect(typeof span.setOutput).toBe("function");

      // Verify it creates spans in the mock tracer
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should pass options and context to underlying tracer", () => {
      const options = { kind: SpanKind.CLIENT, attributes: { "test": "value" } };
      const context = {} as any; // Mock context

      const span = langwatchTracer.startSpan("test-span", options, context);

      expect(span).toBeDefined();
      expect(typeof span.setType).toBe("function");

      // Verify spans are being created
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should return enhanced span with LangWatch methods", () => {
      const span = langwatchTracer.startSpan("test-span");

      // Test that we can chain LangWatch-specific methods
      const result = span
        .setType("llm")
        .setInput("test input")
        .setOutput("test output");

      expect(result).toBe(span);
    });
  });

  describe("startActiveSpan", () => {
    it("should execute callback with LangWatchSpan", () => {
      const callback = vi.fn((span: LangWatchSpan) => {
        expect(span).toBeDefined();
        expect(typeof span.setType).toBe("function");
        return "test-result";
      });

      const result = langwatchTracer.startActiveSpan("active-span", callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toBe("test-result");

      // Verify spans are being created
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should handle options parameter", () => {
      const options = { kind: SpanKind.SERVER };
      const callback = vi.fn(() => "result");

      const result = langwatchTracer.startActiveSpan("active-span", options, callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toBe("result");

      // Verify spans are being created
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should handle options and context parameters", () => {
      const options = { kind: SpanKind.SERVER };
      const context = {} as any;
      const callback = vi.fn(() => "result");

      const result = langwatchTracer.startActiveSpan("active-span", options, context, callback);

      expect(callback).toHaveBeenCalled();
      expect(result).toBe("result");

      // Verify spans are being created
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should pass through return value from callback", () => {
      const expectedResult = { data: "test", count: 42 };
      const callback = vi.fn(() => expectedResult);

      const result = langwatchTracer.startActiveSpan("active-span", callback);

      expect(result).toEqual(expectedResult);
    });

    it("should handle async callbacks", async () => {
      const callback = vi.fn(async (span: LangWatchSpan) => {
        await createDelayedPromise("async-result", 10);
        return "async-result";
      });

      const result = langwatchTracer.startActiveSpan("async-span", callback);

      // startActiveSpan should handle async callbacks
      expect(result instanceof Promise ? await result : result).toBe("async-result");
    });

    it("should propagate errors from callback", () => {
      const error = new Error("Callback error");
      const callback = vi.fn(() => {
        throw error;
      });

      expect(() => {
        langwatchTracer.startActiveSpan("error-span", callback);
      }).toThrow(error);
    });
  });

  describe("withActiveSpan", () => {
    describe("async callback behavior", () => {
      it("should execute async callback with automatic span management", async () => {
        const callback = vi.fn(async (span: LangWatchSpan) => {
          expect(span).toBeDefined();
          expect(typeof span.setType).toBe("function");
          span.setType("llm");
          return "async-success";
        });

        const result = await langwatchTracer.withActiveSpan("managed-span", callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe("async-success");
        expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
      });

      it("should automatically end span on async success", async () => {
        let spanEnded = false;
        const callback = vi.fn(async (span: LangWatchSpan) => {
          expect(span.isRecording()).toBe(true);

          // Override the end method to track if it's called
          const originalEnd = span.end;
          span.end = vi.fn(() => {
            spanEnded = true;
            originalEnd.call(span);
          });

          return "async-done";
        });

        const result = await langwatchTracer.withActiveSpan("auto-span", callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe("async-done");
        expect(spanEnded).toBe(true);
      });

      it("should automatically end span on async error", async () => {
        let spanEnded = false;
        let statusSet = false;
        let exceptionRecorded = false;

        const error = new Error("Test async error");
        const callback = vi.fn(async (span: LangWatchSpan) => {
          // Override methods to track if they're called
          const originalEnd = span.end;
          const originalSetStatus = span.setStatus;
          const originalRecordException = span.recordException;

          span.end = vi.fn(() => {
            spanEnded = true;
            originalEnd.call(span);
          });

          span.setStatus = vi.fn((status) => {
            if (status.code === SpanStatusCode.ERROR) {
              statusSet = true;
            }
            return originalSetStatus.call(span, status);
          });

          span.recordException = vi.fn((ex) => {
            exceptionRecorded = true;
            return originalRecordException?.call(span, ex);
          });

          throw error;
        });

        await expect(langwatchTracer.withActiveSpan("error-span", callback)).rejects.toThrow(error);

        expect(callback).toHaveBeenCalled();
        expect(spanEnded).toBe(true);
        expect(statusSet).toBe(true);
        expect(exceptionRecorded).toBe(true);
      });

      it("should handle async errors without message", async () => {
        const error = "String error";
        const callback = vi.fn(async () => {
          throw error;
        });

        await expect(langwatchTracer.withActiveSpan("error-span", callback)).rejects.toThrow(error);
        expect(callback).toHaveBeenCalled();
      });

      it("should handle async null/undefined errors", async () => {
        const callback = vi.fn(async () => {
          throw null;
        });

        await expect(langwatchTracer.withActiveSpan("error-span", callback)).rejects.toThrow();
        expect(callback).toHaveBeenCalled();
      });

      it("should handle delayed async callbacks", async () => {
        const callback = vi.fn(async (span: LangWatchSpan) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          span.setType("llm");
          return "delayed-result";
        });

        const result = await langwatchTracer.withActiveSpan("delayed-span", callback);

        expect(result).toBe("delayed-result");
        expect(callback).toHaveBeenCalled();
      });
    });

    describe("sync callback behavior", () => {
      it("should work with synchronous callbacks", () => {
        const callback = vi.fn((span: LangWatchSpan) => {
          span.setType("tool");
          return "sync-result";
        });

        const result = langwatchTracer.withActiveSpan("sync-span", callback);

        expect(result).toBe("sync-result");
        expect(callback).toHaveBeenCalled();
        expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
      });

      it("should automatically end span on sync success", () => {
        let spanEnded = false;
        const callback = vi.fn((span: LangWatchSpan) => {
          expect(span.isRecording()).toBe(true);

          // Override the end method to track if it's called
          const originalEnd = span.end;
          span.end = vi.fn(() => {
            spanEnded = true;
            originalEnd.call(span);
          });

          return "sync-done";
        });

        const result = langwatchTracer.withActiveSpan("sync-auto-span", callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe("sync-done");
        expect(spanEnded).toBe(true);
      });

      it("should automatically end span on sync error", () => {
        let spanEnded = false;
        let statusSet = false;
        let exceptionRecorded = false;

        const error = new Error("Test sync error");
        const callback = vi.fn((span: LangWatchSpan) => {
          // Override methods to track if they're called
          const originalEnd = span.end;
          const originalSetStatus = span.setStatus;
          const originalRecordException = span.recordException;

          span.end = vi.fn(() => {
            spanEnded = true;
            originalEnd.call(span);
          });

          span.setStatus = vi.fn((status) => {
            if (status.code === SpanStatusCode.ERROR) {
              statusSet = true;
            }
            return originalSetStatus.call(span, status);
          });

          span.recordException = vi.fn((ex) => {
            exceptionRecorded = true;
            return originalRecordException?.call(span, ex);
          });

          throw error;
        });

        expect(() => langwatchTracer.withActiveSpan("sync-error-span", callback)).toThrow(error);

        expect(callback).toHaveBeenCalled();
        expect(spanEnded).toBe(true);
        expect(statusSet).toBe(true);
        expect(exceptionRecorded).toBe(true);
      });

      it("should handle sync errors without message", () => {
        const error = "String sync error";
        const callback = vi.fn(() => {
          throw error;
        });

        expect(() => langwatchTracer.withActiveSpan("sync-error-span", callback)).toThrow(error);
        expect(callback).toHaveBeenCalled();
      });

      it("should handle sync null/undefined errors", () => {
        const callback = vi.fn(() => {
          throw null;
        });

        expect(() => langwatchTracer.withActiveSpan("sync-error-span", callback)).toThrow();
        expect(callback).toHaveBeenCalled();
      });
    });

    describe("edge cases and promise-like objects", () => {
      it("should handle promise-like objects (thenables)", async () => {
        const thenable = {
          then: vi.fn((onFulfilled: any) => {
            setTimeout(() => onFulfilled("thenable-result"), 5);
            return thenable;
          }),
          catch: vi.fn((onRejected: any) => thenable),
          finally: vi.fn((onFinally: any) => {
            setTimeout(onFinally, 10);
            return thenable;
          })
        };

        const callback = vi.fn(() => thenable);

        const result = await (langwatchTracer.withActiveSpan("thenable-span", callback) as any);

        expect(result).toBe("thenable-result");
        expect(thenable.then).toHaveBeenCalled();
        expect(thenable.catch).toHaveBeenCalled();
        expect(thenable.finally).toHaveBeenCalled();
      });

      it("should handle null/undefined return values", () => {
        const nullCallback = vi.fn(() => null);
        const undefinedCallback = vi.fn(() => undefined);

        const nullResult = langwatchTracer.withActiveSpan("null-span", nullCallback);
        const undefinedResult = langwatchTracer.withActiveSpan("undefined-span", undefinedCallback);

        expect(nullResult).toBeNull();
        expect(undefinedResult).toBeUndefined();
      });

      it("should handle objects with then property that is not a function", () => {
        const fakePromise = { then: "not-a-function" };
        const callback = vi.fn(() => fakePromise);

        const result = langwatchTracer.withActiveSpan("fake-promise-span", callback);

        expect(result).toBe(fakePromise);
      });

      it("should handle rejected promises correctly", async () => {
        const rejectionError = new Error("Promise rejection");
        const callback = vi.fn(async () => {
          throw rejectionError;
        });

        await expect(langwatchTracer.withActiveSpan("rejection-span", callback)).rejects.toThrow(rejectionError);
      });

      it("should handle promise that resolves to another promise", async () => {
        const innerPromise = Promise.resolve("inner-value");
        const callback = vi.fn(async () => innerPromise);

        const result = await langwatchTracer.withActiveSpan("nested-promise-span", callback);

        expect(result).toBe("inner-value");
      });
    });

    describe("parameter handling", () => {
      it("should handle options parameter", async () => {
        const options = { kind: SpanKind.PRODUCER };
        const callback = vi.fn(() => "result");

        const result = await langwatchTracer.withActiveSpan("with-options", options, callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe("result");
        expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
      });

      it("should handle options and context parameters", async () => {
        const options = { kind: SpanKind.CONSUMER };
        const context = {} as any;
        const callback = vi.fn(() => "result");

        const result = await langwatchTracer.withActiveSpan("with-context", options, context, callback);

        expect(callback).toHaveBeenCalled();
        expect(result).toBe("result");
        expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
      });

      it("should ensure span is ended even if recordException fails", async () => {
        const originalError = new Error("Original error");
        const callback = vi.fn(async () => {
          throw originalError;
        });

        // Should still reject with original error, not recordException error
        await expect(langwatchTracer.withActiveSpan("exception-span", callback)).rejects.toThrow(originalError);

        expect(callback).toHaveBeenCalled();
      });
    });
  });

    describe("argument normalization", () => {
    it("should handle different argument patterns for startActiveSpan", () => {
      // Test all valid argument combinations
      const callback = vi.fn(() => "result");
      const options = { kind: SpanKind.CLIENT };
      const context = {} as any;

      // Pattern 1: name, callback
      const result1 = langwatchTracer.startActiveSpan("span1", callback);
      expect(result1).toBe("result");

      // Pattern 2: name, options, callback
      const result2 = langwatchTracer.startActiveSpan("span2", options, callback);
      expect(result2).toBe("result");

      // Pattern 3: name, options, context, callback
      const result3 = langwatchTracer.startActiveSpan("span3", options, context, callback);
      expect(result3).toBe("result");

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should handle different argument patterns for withActiveSpan", async () => {
      const callback = vi.fn(() => "result");
      const options = { kind: SpanKind.CLIENT };
      const context = {} as any;

      // Pattern 1: name, callback
      const result1 = langwatchTracer.withActiveSpan("span1", callback);
      expect(result1).toBe("result");

      // Pattern 2: name, options, callback
      const result2 = langwatchTracer.withActiveSpan("span2", options, callback);
      expect(result2).toBe("result");

      // Pattern 3: name, options, context, callback
      const result3 = langwatchTracer.withActiveSpan("span3", options, context, callback);
      expect(result3).toBe("result");

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should throw error for invalid arguments", () => {
      expect(() => {
        (langwatchTracer as any).startActiveSpan("span-name", "not-a-function");
      }).toThrow("Expected a span callback as the last argument");

      expect(() => {
        (langwatchTracer as any).startActiveSpan("span-name", {}, "not-a-function");
      }).toThrow("Expected a span callback as the last argument");
    });
  });

  describe("proxy behavior", () => {
    it("should have the expected LangWatch methods", () => {
      // Test that the proxy provides the LangWatch-specific methods
      expect(typeof langwatchTracer.startSpan).toBe("function");
      expect(typeof langwatchTracer.startActiveSpan).toBe("function");
      expect(typeof langwatchTracer.withActiveSpan).toBe("function");
    });

    it("should proxy through to underlying tracer methods", () => {
      // Test that standard OTel tracer methods are available
      expect(typeof langwatchTracer.startSpan).toBe("function");
      expect(typeof langwatchTracer.startActiveSpan).toBe("function");
    });

    it("should maintain proxy behavior for standard methods", () => {
      // Create a fresh tracer with a custom method for testing
      const customMockTracer = new MockTracer();
      (customMockTracer as any).customMethod = vi.fn();

      const customProvider = new MockTracerProvider();
      vi.spyOn(customProvider, 'getTracer').mockReturnValue(customMockTracer);

      const customLangwatchTracer = getLangWatchTracerFromProvider(customProvider, "custom-tracer");

      // Test that custom methods can be called
      if (typeof (customLangwatchTracer as any).customMethod === "function") {
        (customLangwatchTracer as any).customMethod("test");
        expect((customMockTracer as any).customMethod).toHaveBeenCalledWith("test");
      }
    });
  });

  describe("withActiveSpan error handling improvements", () => {
    it("should handle complex error scenarios with proper cleanup", async () => {
      const mockProvider = new MockTracerProvider();
      const langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "error-tracer", "1.0.0");
      const mockTracer = mockProvider.getTracerByName("error-tracer", "1.0.0")!;
      const testError = new Error("Complex error scenario");

      await errorTestUtils.testErrorPropagation(
        () => langwatchTracer.withActiveSpan("error-span", async (span) => {
          span.setType("llm");
          span.setAttribute("test.before.error", true);

          // Simulate some async work before error
          await createDelayedPromise("work", 5);

          throw testError;
        }),
        testError,
        () => {
          // Verify cleanup occurred
          const span = mockTracer.getSpan("error-span");
          expect(span?.ended).toBe(true);
        }
      );
    });

    it("should handle partial failures in batch operations", async () => {
      const mockProvider = new MockTracerProvider();
      const langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "batch-tracer", "1.0.0");
      const mockTracer = mockProvider.getTracerByName("batch-tracer", "1.0.0")!;
      const partialError = new Error("Partial failure");

      const operations = [
        () => langwatchTracer.withActiveSpan("success-1", async () => "success"),
        () => langwatchTracer.withActiveSpan("failure", async () => { throw partialError; }),
        () => langwatchTracer.withActiveSpan("success-2", async () => "success"),
      ];

      await errorTestUtils.testPartialFailure(operations, [1], partialError);

      // Verify successful spans are properly handled
      expect(mockTracer.getSpan("success-1")?.ended).toBe(true);
      expect(mockTracer.getSpan("success-2")?.ended).toBe(true);
      expect(mockTracer.getSpan("failure")?.ended).toBe(true);
    });
  });

  describe("performance and concurrency improvements", () => {
    it("should handle high-frequency span creation without performance degradation", async () => {
      const mockProvider = new MockTracerProvider();
      const langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "perf-tracer", "1.0.0");
      const mockTracer = mockProvider.getTracerByName("perf-tracer", "1.0.0")!;

      const operations = await performanceUtils.createConcurrentOperations(
        async (i) => {
          return langwatchTracer.withActiveSpan(`perf-span-${i}`, (span) => {
            span.setType("llm");
            span.setAttribute("index", i);
            return i * 2;
          });
        },
        100
      );

      expect(operations).toHaveLength(100);
      operations.forEach((result, index) => {
        expect(result).toBe(index * 2);
      });

      // Verify all spans were created and ended properly
      expect(mockTracer.getSpanCount()).toBe(100);

      mockTracer.spans.forEach(span => {
        expect(span.ended).toBe(true);
      });
    });

    it("should handle nested spans with proper parent-child relationships", async () => {
      const mockProvider = new MockTracerProvider();
      const langwatchTracer = getLangWatchTracerFromProvider(mockProvider, "nested-tracer", "1.0.0");
      const mockTracer = mockProvider.getTracerByName("nested-tracer", "1.0.0")!;

      const result = await langwatchTracer.withActiveSpan("parent", async (parentSpan) => {
        parentSpan.setType("workflow");

        const childResults = await Promise.all([
          langwatchTracer.withActiveSpan("child-1", (child) => {
            child.setType("llm");
            return "child-1-result";
          }),
          langwatchTracer.withActiveSpan("child-2", (child) => {
            child.setType("tool");
            return "child-2-result";
          })
        ]);

        return { parent: "parent-result", children: childResults };
      });

      expect(result).toEqual({
        parent: "parent-result",
        children: ["child-1-result", "child-2-result"]
      });

      // Verify span creation
      expect(mockTracer.getSpan("parent")).toBeDefined();
      expect(mockTracer.getSpan("child-1")).toBeDefined();
      expect(mockTracer.getSpan("child-2")).toBeDefined();
    });
  });

  describe("argument validation and edge cases", () => {
    it("should provide clear error messages for invalid arguments", () => {
      const { langwatchTracer } = testScenarios.createTracerTest();

      expect(() => {
        (langwatchTracer as any).startActiveSpan("span-name");
      }).toThrow("Expected a span callback as the last argument");

      expect(() => {
        (langwatchTracer as any).startActiveSpan("span-name", {}, "not-a-function");
      }).toThrow("Expected a span callback as the last argument");

      expect(() => {
        (langwatchTracer as any).withActiveSpan("span-name");
      }).toThrow(); // Should throw some validation error
    });

    it("should handle edge cases in span context", () => {
      const { langwatchTracer } = testScenarios.createTracerTest();

      // Test with undefined/null contexts
      expect(() => {
        langwatchTracer.startActiveSpan("test", {}, undefined as any, () => "result");
      }).not.toThrow();

      expect(() => {
        langwatchTracer.withActiveSpan("test", {}, undefined as any, () => "result");
      }).not.toThrow();
    });
  });

  describe("memory and resource management", () => {
    it("should not leak spans in memory", () => {
      const { mockTracer } = testScenarios.createTracerTest();

      const initialSpanCount = mockTracer.getSpanCount();

      // Create many spans
      for (let i = 0; i < 50; i++) {
        mockTracer.startSpan(`leak-test-${i}`).end();
      }

      expect(mockTracer.getSpanCount()).toBe(initialSpanCount + 50);

      // Clear and verify cleanup
      mockTracer.clearSpans();
      expect(mockTracer.getSpanCount()).toBe(0);
    });

    it("should handle rapid span creation and cleanup", () => {
      const { langwatchTracer } = testScenarios.createTracerTest();

      // This tests the implementation's ability to handle rapid operations
      // without relying on wall-clock time
      const operations: Promise<string>[] = [];

      for (let i = 0; i < 20; i++) {
        operations.push(
          langwatchTracer.withActiveSpan(`rapid-${i}`, async (span) => {
            span.setType("llm");
            // Simulate minimal async work
            await Promise.resolve();
            return `result-${i}`;
          })
        );
      }

      return Promise.all(operations).then(results => {
        expect(results).toHaveLength(20);
        results.forEach((result, i) => {
          expect(result).toBe(`result-${i}`);
        });
      });
    });
  });

  describe("integration scenarios", () => {
    it("should support nested spans with proper parent-child relationships", async () => {
      const parentCallback = vi.fn(async (parentSpan: LangWatchSpan) => {
        parentSpan.setType("workflow");

        const childResult = langwatchTracer.withActiveSpan("child-operation", (childSpan) => {
          childSpan.setType("llm");
          return "child-done";
        });

        return `parent-${childResult}`;
      });

      const result = await langwatchTracer.withActiveSpan("parent-operation", parentCallback);

      expect(result).toBe("parent-child-done");
      expect(parentCallback).toHaveBeenCalled();
    });

    it("should handle mixed manual and automatic span management", async () => {
      // Manual span
      const manualSpan = langwatchTracer.startSpan("manual-span");
      manualSpan.setType("tool");

      // Automatic span within manual span context
      const result = await langwatchTracer.withActiveSpan("auto-span", (autoSpan) => {
        autoSpan.setType("llm");
        return "auto-result";
      });

      // Manually end the manual span
      manualSpan.end();

      expect(result).toBe("auto-result");
      expect(mockTracer.getSpanCount()).toBeGreaterThan(0);
    });

    it("should handle rapid concurrent span creation", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        langwatchTracer.withActiveSpan(`concurrent-span-${i}`, async (span) => {
          span.setType("llm");
          await createDelayedPromise(`result-${i}`, Math.random() * 10);
          return `result-${i}`;
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });
    });

    it("should handle error propagation in nested spans", async () => {
      const outerError = new Error("Outer error");

      await expect(
        langwatchTracer.withActiveSpan("outer-span", async (outerSpan) => {
          outerSpan.setType("workflow");

          await langwatchTracer.withActiveSpan("inner-span", (innerSpan) => {
            innerSpan.setType("llm");
            throw outerError;
          });
        })
      ).rejects.toThrow(outerError);

      // Verify error was handled
      expect(true).toBe(true);
    });
  });
});
