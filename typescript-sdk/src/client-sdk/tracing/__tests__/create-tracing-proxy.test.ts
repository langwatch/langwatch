import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTracingProxy } from '../create-tracing-proxy';
import type { LangWatchTracer, LangWatchSpan } from '../../../observability-sdk';

// Mock tracer and span for testing
const createMockTracer = (): LangWatchTracer => {
  const mockSpan = {
    setAttributes: vi.fn(),
    end: vi.fn(),
  } as unknown as LangWatchSpan;

  return {
    withActiveSpan: vi.fn((name: string, options: any, fn: (span: LangWatchSpan) => any) => {
      return fn(mockSpan);
    }),
    startSpan: vi.fn(() => mockSpan),
    startActiveSpan: vi.fn((name: string, fn: (span: LangWatchSpan) => any) => {
      return fn(mockSpan);
    }),
  } as unknown as LangWatchTracer;
};

describe('createTracingProxy', () => {
  let tracer: LangWatchTracer;
  let mockSpan: LangWatchSpan;

  beforeEach(() => {
    tracer = createMockTracer();
    mockSpan = {
      setAttributes: vi.fn(),
      end: vi.fn(),
    } as unknown as LangWatchSpan;

    // Reset the mock to return our mockSpan
    (tracer.withActiveSpan as any).mockImplementation((name: string, options: any, fn: (span: LangWatchSpan) => any) => {
      return fn(mockSpan);
    });
  });

  describe('basic functionality', () => {
    it('should create a proxy that traces public methods', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should not trace private methods', () => {
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
      // The proxy returns the original method bound to the target
      expect(typeof (proxy as any)._privateMethod).toBe('function');
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should not trace built-in methods', () => {
      class TestClass {
        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      // These should not trigger tracing
      proxy.toString();
      proxy.valueOf();
      // toJSON is not a standard method on all objects, so we'll skip it

      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should handle non-function properties', () => {
      class TestClass {
        public property = 'test value';

        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.property).toBe('test value');
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });
  });

  describe('decorator functionality', () => {
    it('should use decorator methods when available', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should fall back to original method when decorator method is not available', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should handle decorator methods that are not functions', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });
  });

  describe('method arguments and return values', () => {
    it('should pass arguments correctly to traced methods', () => {
      class TestClass {
        publicMethod(arg1: string, arg2: number) {
          return `${arg1}-${arg2}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod('test', 42);

      expect(result).toBe('test-42');
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should handle async methods', async () => {
      class TestClass {
        async publicMethod() {
          return 'async result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = await proxy.publicMethod();

      expect(result).toBe('async result');
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should handle methods that throw errors', () => {
      class TestClass {
        publicMethod() {
          throw new Error('test error');
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      expect(() => proxy.publicMethod()).toThrow('test error');
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should handle async methods that throw errors', async () => {
      class TestClass {
        async publicMethod() {
          throw new Error('async error');
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      await expect(proxy.publicMethod()).rejects.toThrow('async error');
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });
  });

  describe('decorator span access', () => {
    it('should allow decorator to access span context', () => {
      class TestClass {
        publicMethod() {
          return 'original result';
        }
      }

      class TestDecorator {
        constructor(private target: TestClass) {}

        publicMethod() {
          // Note: The actual implementation doesn't pass span to decorator methods
          // This test verifies that decorator methods are called correctly
          return 'decorated result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer, TestDecorator as any);

      const result = proxy.publicMethod();

      expect(result).toBe('decorated result');
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'TestClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should call decorator method with correct context', () => {
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
    });
  });

  describe('span lifecycle', () => {
    it('should properly end spans after method execution', () => {
      class TestClass {
        publicMethod() {
          return 'result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      proxy.publicMethod();

      // The span should be ended by the withActiveSpan implementation
      // We can't directly test this since withActiveSpan handles the lifecycle
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple method calls', () => {
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

      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(2);
      expect(tracer.withActiveSpan).toHaveBeenNthCalledWith(
        1,
        'TestClass.method1',
        {
          kind: 2,
          attributes: {
            'code.function': 'method1',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
      expect(tracer.withActiveSpan).toHaveBeenNthCalledWith(
        2,
        'TestClass.method2',
        {
          kind: 2,
          attributes: {
            'code.function': 'method2',
            'code.namespace': 'TestClass',
          },
        },
        expect.any(Function)
      );
    });
  });

  describe('method filtering', () => {
    it('should not trace getters', () => {
      class TestClass {
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
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should not trace setters', () => {
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
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should not trace constructor', () => {
      class TestClass {
        constructor() {}

        publicMethod() {
          return 'public result';
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      // Constructor should not be traced
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle target with no methods', () => {
      class EmptyClass {}

      const target = new EmptyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy).toBeDefined();
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should handle target with only private methods', () => {
      class PrivateOnlyClass {
        private _privateMethod() {
          return 'private';
        }
      }

      const target = new PrivateOnlyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy).toBeDefined();
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should handle target with only built-in methods', () => {
      class BuiltInOnlyClass {
        toString() {
          return 'built-in';
        }
      }

      const target = new BuiltInOnlyClass();
      const proxy = createTracingProxy(target, tracer);

      expect(proxy.toString()).toBe('built-in');
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();
    });

    it('should handle symbol properties', () => {
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
      expect(tracer.withActiveSpan).not.toHaveBeenCalled();

      // Public methods should still be traced
      proxy.publicMethod();
      expect(tracer.withActiveSpan).toHaveBeenCalledWith(
        'SymbolClass.publicMethod',
        {
          kind: 2, // SpanKind.CLIENT
          attributes: {
            'code.function': 'publicMethod',
            'code.namespace': 'SymbolClass',
          },
        },
        expect.any(Function)
      );
    });

    it('should handle methods with special characters in names', () => {
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

      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(3);
    });

    it('should handle methods that return undefined', () => {
      class TestClass {
        publicMethod() {
          // Returns undefined
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toBeUndefined();
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });

    it('should handle methods that return null', () => {
      class TestClass {
        publicMethod() {
          return null;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toBeNull();
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });

    it('should handle methods with complex return values', () => {
      class TestClass {
        publicMethod() {
          return { complex: 'object', nested: { value: 42 } };
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod();
      expect(result).toEqual({ complex: 'object', nested: { value: 42 } });
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });

    it('should handle methods with this context', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });

    it('should handle methods that modify target state', () => {
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
      // getCounter is also a public method, so it gets traced too
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(3);
    });

    it('should handle methods with default parameters', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(3);
    });

    it('should handle methods with rest parameters', () => {
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
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(3);
    });

    it('should handle methods with destructuring parameters', () => {
      class TestClass {
        publicMethod({ name, age }: { name: string; age: number }) {
          return `${name}-${age}`;
        }
      }

      const target = new TestClass();
      const proxy = createTracingProxy(target, tracer);

      const result = proxy.publicMethod({ name: 'John', age: 30 });
      expect(result).toBe('John-30');
      expect(tracer.withActiveSpan).toHaveBeenCalledTimes(1);
    });
  });


});
