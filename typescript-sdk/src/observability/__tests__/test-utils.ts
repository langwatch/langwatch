import { vi, expect } from "vitest";
import {
  Span,
  SpanContext,
  SpanStatus,
  Link,
  Exception,
  AttributeValue,
  Attributes,
  Tracer,
  TracerProvider,
  SpanOptions,
  Context,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { createLangWatchSpan } from "../span";
import { getLangWatchTracerFromProvider } from "../tracer";

/**
 * Mock implementation of OpenTelemetry Span for testing
 */
export class MockSpan implements Span {
  private _name: string;
  private _attributes: Record<string, AttributeValue> = {};
  private _events: Array<{ name: string; attributes?: Attributes; timestamp?: number }> = [];
  private _status?: SpanStatus;
  private _ended = false;
  private _links: Link[] = [];
  private _startTime: number;
  private _endTime?: number;

  constructor(name: string = "test-span") {
    this._name = name;
    this._ended = false;
    this._startTime = Date.now();
  }

  // Spy methods for testing
  public readonly setAttribute = vi.fn((key: string, value: AttributeValue) => {
    this._attributes[key] = value;
    return this;
  });

  public readonly setAttributes = vi.fn((attributes: Attributes) => {
    Object.assign(this._attributes, attributes);
    return this;
  });

  public readonly addEvent = vi.fn((name: string, attributes?: Attributes, timestamp?: number) => {
    this._events.push({ name, attributes, timestamp });
    return this;
  });

  public readonly recordException = vi.fn((exception: Exception) => {
    const exceptionName = typeof exception === "object" && exception !== null && "name" in exception
      ? (exception as any).name
      : "Error";
    const exceptionMessage = typeof exception === "object" && exception !== null && "message" in exception
      ? (exception as any).message
      : String(exception);

    this._events.push({
      name: "exception",
      attributes: {
        "exception.type": exceptionName,
        "exception.message": exceptionMessage,
      },
    });
    return this;
  });

  public readonly setStatus = vi.fn((status: SpanStatus) => {
    this._status = status;
    return this;
  });

  public readonly updateName = vi.fn((name: string) => {
    this._name = name;
    return this;
  });

  public readonly end = vi.fn((endTime?: number) => {
    if (this._ended) {
      // Real OTel spans ignore duplicate end() calls
      return;
    }
    this._ended = true;
    this._endTime = endTime || Date.now();
  });

  public readonly addLink = vi.fn((link: Link) => {
    this._links.push(link);
    return this;
  });

  public readonly addLinks = vi.fn((links: Link[]) => {
    this._links.push(...links);
    return this;
  });

  public isRecording(): boolean {
    return !this._ended;
  }

  public spanContext(): SpanContext {
    return {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: 1,
    };
  }

  // Enhanced getters for better test assertions
  get duration(): number | undefined {
    if (this._endTime) {
      return this._endTime - this._startTime;
    }
    return undefined;
  }

  get startTime(): number {
    return this._startTime;
  }

  get endTime(): number | undefined {
    return this._endTime;
  }

  // Getters for test assertions
  get name(): string {
    return this._name;
  }

  get attributes(): Record<string, AttributeValue> {
    return { ...this._attributes };
  }

  get events(): Array<{ name: string; attributes?: Attributes; timestamp?: number }> {
    return [...this._events];
  }

  get status(): SpanStatus | undefined {
    return this._status;
  }

  get ended(): boolean {
    return this._ended;
  }

  get links(): Link[] {
    return [...this._links];
  }

  // Better assertion helpers
  public expectAttribute(key: string, value?: AttributeValue): void {
    const actualValue = this._attributes[key];
    if (value !== undefined) {
      expect(actualValue).toBe(value);
    } else {
      expect(actualValue).toBeDefined();
    }
  }

  public expectEvent(name: string, attributes?: Partial<Attributes>): void {
    const event = this._events.find(e => e.name === name);
    expect(event).toBeDefined();

    if (attributes && event) {
      Object.entries(attributes).forEach(([key, expectedValue]) => {
        expect(event.attributes?.[key]).toBe(expectedValue);
      });
    }
  }

  public expectStatus(code: SpanStatusCode, message?: string): void {
    expect(this._status?.code).toBe(code);
    if (message !== undefined) {
      expect(this._status?.message).toBe(message);
    }
  }

  public expectEnded(): void {
    expect(this._ended).toBe(true);
    expect(this._endTime).toBeDefined();
  }

  public expectRecording(): void {
    expect(this._ended).toBe(false);
    expect(this._endTime).toBeUndefined();
  }

  // Helper methods for assertions
  public getAttributeValue(key: string): AttributeValue | undefined {
    return this._attributes[key];
  }

  public hasEvent(name: string): boolean {
    return this._events.some(event => event.name === name);
  }

  public getEvent(name: string): { name: string; attributes?: Attributes; timestamp?: number } | undefined {
    return this._events.find(event => event.name === name);
  }

  public getEventCount(name?: string): number {
    if (name) {
      return this._events.filter(event => event.name === name).length;
    }
    return this._events.length;
  }
}

/**
 * Mock implementation of OpenTelemetry Tracer for testing
 */
export class MockTracer implements Tracer {
  private _spans: MockSpan[] = [];

  public readonly startSpan = vi.fn((name: string, options?: SpanOptions, context?: Context): MockSpan => {
    const span = new MockSpan(name);
    this._spans.push(span);
    return span;
  });

  public readonly startActiveSpan = vi.fn(<F extends (span: Span, ...args: any[]) => any>(
    name: string,
    fnOrOptions: F | SpanOptions,
    optionsOrContextOrFn?: SpanOptions | Context | F,
    contextOrFn?: Context | F,
    fn?: F
  ): ReturnType<F> => {
    // Normalize arguments to match OpenTelemetry API
    let actualFn: F;
    let options: SpanOptions | undefined;
    let context: Context | undefined;

    if (typeof fnOrOptions === "function") {
      actualFn = fnOrOptions;
    } else if (typeof optionsOrContextOrFn === "function") {
      options = fnOrOptions as SpanOptions;
      actualFn = optionsOrContextOrFn;
    } else if (typeof contextOrFn === "function") {
      options = fnOrOptions as SpanOptions;
      context = optionsOrContextOrFn as Context;
      actualFn = contextOrFn;
    } else if (typeof fn === "function") {
      options = fnOrOptions as SpanOptions;
      context = optionsOrContextOrFn as Context;
      actualFn = fn;
    } else {
      throw new Error("No callback function provided");
    }

    const span = this.startSpan(name, options, context);
    return actualFn(span) as ReturnType<F>;
  });

  // Getters for test assertions
  get spans(): MockSpan[] {
    return [...this._spans];
  }

  public getSpan(name: string): MockSpan | undefined {
    return this._spans.find(span => span.name === name);
  }

  public getSpanCount(): number {
    return this._spans.length;
  }

  public clearSpans(): void {
    this._spans = [];
  }
}

/**
 * Mock implementation of OpenTelemetry TracerProvider for testing
 */
export class MockTracerProvider implements TracerProvider {
  private _tracers: Map<string, MockTracer> = new Map();

  public readonly getTracer = vi.fn((name: string, version?: string): MockTracer => {
    const key = `${name}@${version || "latest"}`;
    if (!this._tracers.has(key)) {
      this._tracers.set(key, new MockTracer());
    }
    return this._tracers.get(key)!;
  });

  // Getters for test assertions
  get tracers(): Map<string, MockTracer> {
    return new Map(this._tracers);
  }

  public getTracerByName(name: string, version?: string): MockTracer | undefined {
    const key = `${name}@${version || "latest"}`;
    return this._tracers.get(key);
  }

  public clearTracers(): void {
    this._tracers.clear();
  }
}

/**
 * Test data factories for creating test objects
 */
export const testData = {
  ragContext: () => ({
    document_id: "doc-123",
    chunk_id: "chunk-456",
    content: "Test content for RAG context",
  }),

  ragContexts: () => [
    {
      document_id: "doc-123",
      chunk_id: "chunk-456",
      content: "First test content",
    },
    {
      document_id: "doc-789",
      chunk_id: "chunk-012",
      content: "Second test content",
    },
  ],

  metrics: () => ({
    promptTokens: 100,
    completionTokens: 50,
    cost: 0.001,
  }),

  systemMessage: () => ({
    content: "You are a helpful assistant.",
    role: "system" as const,
  }),

  userMessage: () => ({
    content: "Hello, how are you?",
    role: "user" as const,
  }),

  assistantMessage: () => ({
    content: "I'm doing well, thank you!",
    role: "assistant" as const,
  }),

  assistantMessageWithToolCalls: () => ({
    content: "I'll help you with that calculation.",
    role: "assistant" as const,
    tool_calls: [
      {
        id: "call_123",
        type: "function" as const,
        function: {
          name: "calculate",
          arguments: '{"operation": "add", "numbers": [1, 2]}',
        },
      },
    ],
  }),

  toolMessage: () => ({
    id: "call_123",
    content: "The result is 3",
    role: "tool" as const,
  }),

  choiceEvent: () => ({
    finish_reason: "stop" as const,
    index: 0,
    message: {
      content: "Generated response",
      role: "assistant" as const,
    },
  }),

  spanOptions: (): SpanOptions => ({
    kind: SpanKind.INTERNAL,
    attributes: {
      "test.attribute": "test-value",
    },
  }),
};

/**
 * Custom matchers for vitest
 */
export const matchers = {
  /**
   * Assert that a span has a specific attribute with expected value
   */
  toHaveAttribute: (span: MockSpan, key: string, expectedValue?: AttributeValue) => {
    const actualValue = span.getAttributeValue(key);
    const hasAttribute = actualValue !== undefined;

    if (expectedValue !== undefined) {
      return {
        pass: hasAttribute && actualValue === expectedValue,
        message: () =>
          hasAttribute
            ? `Expected span to have attribute "${key}" with value "${expectedValue}", but got "${actualValue}"`
            : `Expected span to have attribute "${key}" but it was not found`,
      };
    }

    return {
      pass: hasAttribute,
      message: () => `Expected span to have attribute "${key}" but it was not found`,
    };
  },

  /**
   * Assert that a span has an event with a specific name
   */
  toHaveEvent: (span: MockSpan, eventName: string) => {
    const hasEvent = span.hasEvent(eventName);
    return {
      pass: hasEvent,
      message: () => `Expected span to have event "${eventName}" but it was not found`,
    };
  },

  /**
   * Assert that a span has been ended
   */
  toBeEnded: (span: MockSpan) => {
    return {
      pass: span.ended,
      message: () => `Expected span to be ended but it was still recording`,
    };
  },

  /**
   * Assert that a span has a specific status
   */
  toHaveStatus: (span: MockSpan, expectedStatus: SpanStatus) => {
    const actualStatus = span.status;
    const hasCorrectStatus = actualStatus?.code === expectedStatus.code &&
      actualStatus?.message === expectedStatus.message;

    return {
      pass: hasCorrectStatus,
      message: () =>
        `Expected span to have status ${JSON.stringify(expectedStatus)} but got ${JSON.stringify(actualStatus)}`,
    };
  },
};

/**
 * Setup function to configure common test environment
 */
export function setupTestEnvironment() {
  const mockProvider = new MockTracerProvider();
  const mockTracer = mockProvider.getTracer("test-tracer");

  return {
    mockProvider,
    mockTracer,
    cleanup: () => {
      mockProvider.clearTracers();
      vi.clearAllMocks();
    },
  };
}

/**
 * Utility to create a promise that resolves after all microtasks
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Utility to create a promise that rejects
 */
export function createRejectedPromise(error: Error): Promise<never> {
  return Promise.reject(error);
}

/**
 * Utility to create a delayed promise
 */
export function createDelayedPromise<T>(value: T, delay: number = 0): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), delay));
}

/**
 * Test scenario builders for common testing patterns
 */
export const testScenarios = {
  /**
   * Creates a basic span test scenario
   */
  createSpanTest: (spanName: string = "test-span") => {
    const mockSpan = new MockSpan(spanName);
    const langwatchSpan = createLangWatchSpan(mockSpan);
    return { mockSpan, langwatchSpan };
  },

  /**
   * Creates a tracer test scenario with provider
   */
  createTracerTest: (tracerName: string = "test-tracer", version?: string) => {
    const mockProvider = new MockTracerProvider();
    const langwatchTracer = getLangWatchTracerFromProvider(mockProvider, tracerName, version);
    const mockTracer = mockProvider.getTracerByName(tracerName, version)!;
    return { mockProvider, langwatchTracer, mockTracer };
  },

  /**
   * Creates an async test scenario with error handling
   */
  createAsyncTest: async <T>(
    operation: () => Promise<T>,
    options: {
      expectSuccess?: boolean;
      expectedError?: Error;
      timeout?: number;
    } = {}
  ) => {
    const { expectSuccess = true, expectedError, timeout = 1000 } = options;

    let result: T | undefined;
    let error: Error | undefined;

    try {
      result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Test timeout')), timeout)
        )
      ]);
    } catch (e) {
      error = e as Error;
    }

    if (expectSuccess) {
      expect(error).toBeUndefined();
      expect(result).toBeDefined();
    } else {
      expect(error).toBeDefined();
      if (expectedError) {
        expect(error?.message).toBe(expectedError.message);
      }
    }

    return { result, error };
  },

  /**
   * Validates span lifecycle
   */
  validateSpanLifecycle: (span: MockSpan, expectedStates: {
    shouldBeRecording?: boolean;
    shouldBeEnded?: boolean;
    shouldHaveAttributes?: Record<string, AttributeValue>;
    shouldHaveEvents?: string[];
  }) => {
    const {
      shouldBeRecording,
      shouldBeEnded,
      shouldHaveAttributes,
      shouldHaveEvents
    } = expectedStates;

    if (shouldBeRecording !== undefined) {
      expect(span.isRecording()).toBe(shouldBeRecording);
    }

    if (shouldBeEnded !== undefined) {
      expect(span.ended).toBe(shouldBeEnded);
    }

    if (shouldHaveAttributes) {
      Object.entries(shouldHaveAttributes).forEach(([key, value]) => {
        span.expectAttribute(key, value);
      });
    }

    if (shouldHaveEvents) {
      shouldHaveEvents.forEach(eventName => {
        span.expectEvent(eventName);
      });
    }
  }
};

/**
 * Performance testing utilities
 */
export const performanceUtils = {
  /**
   * Measures execution time of an operation
   */
  measureTime: async <T>(operation: () => Promise<T> | T): Promise<{ result: T; duration: number }> => {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;
    return { result, duration };
  },

  /**
   * Creates multiple concurrent operations for stress testing
   */
  createConcurrentOperations: <T>(
    operationFactory: (index: number) => Promise<T>,
    count: number
  ): Promise<T[]> => {
    const operations = Array.from({ length: count }, (_, i) => operationFactory(i));
    return Promise.all(operations);
  },

  /**
   * Validates performance expectations
   */
  expectPerformance: (duration: number, expectations: {
    maxDuration?: number;
    minDuration?: number;
    averageOf?: number[];
  }) => {
    const { maxDuration, minDuration, averageOf } = expectations;

    if (maxDuration !== undefined) {
      expect(duration).toBeLessThanOrEqual(maxDuration);
    }

    if (minDuration !== undefined) {
      expect(duration).toBeGreaterThanOrEqual(minDuration);
    }

    if (averageOf) {
      const average = averageOf.reduce((sum, d) => sum + d, 0) / averageOf.length;
      // Allow 50% variance from average
      expect(duration).toBeLessThanOrEqual(average * 1.5);
      expect(duration).toBeGreaterThanOrEqual(average * 0.5);
    }
  }
};

/**
 * Enhanced error testing utilities
 */
export const errorTestUtils = {
  /**
   * Tests error propagation in nested operations
   */
  testErrorPropagation: async (
    operation: () => Promise<any>,
    expectedError: Error,
    cleanupValidation?: () => void
  ) => {
    await expect(operation()).rejects.toThrow(expectedError);
    if (cleanupValidation) {
      cleanupValidation();
    }
  },

  /**
   * Tests partial failure scenarios
   */
  testPartialFailure: async <T>(
    operations: Array<() => Promise<T>>,
    failureIndices: number[],
    expectedError: Error
  ) => {
    const results = await Promise.allSettled(operations.map(op => op()));

    results.forEach((result, index) => {
      if (failureIndices.includes(index)) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toBe(expectedError.message);
        }
      } else {
        expect(result.status).toBe('fulfilled');
      }
    });
  }
};
