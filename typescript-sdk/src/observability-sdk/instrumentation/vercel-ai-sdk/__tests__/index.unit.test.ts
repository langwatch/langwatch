import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AISDKSpanProcessor,
  isAISDKSpan,
  getAISDKSpanType,
  getSupportedAISDKSpans
} from '..';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Span, ReadableSpan } from '@opentelemetry/sdk-trace-base';

describe('AISDKSpanProcessor', () => {
  let processor: AISDKSpanProcessor;
  let mockSpan: Partial<Span>;

  beforeEach(() => {
    processor = new AISDKSpanProcessor();
    mockSpan = {
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
    } as any;
  });

  describe('onStart', () => {
    it('enriches AI SDK spans with LangWatch attributes', () => {
      (mockSpan as any).name = 'ai.streamText';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'llm');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.ai_sdk.instrumented', true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.ai_sdk.span_name', 'ai.streamText');
    });

    it('correctly maps ai.generateText to llm type', () => {
      (mockSpan as any).name = 'ai.generateText';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'llm');
    });

    it('correctly maps ai.toolCall to tool type', () => {
      (mockSpan as any).name = 'ai.toolCall';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'tool');
    });

    it('correctly maps ai.embed to component type', () => {
      (mockSpan as any).name = 'ai.embed';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'component');
    });

    it('defaults unknown AI SDK spans to llm type', () => {
      (mockSpan as any).name = 'ai.unknownOperation';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'llm');
    });

    it('ignores non-AI SDK spans', () => {
      (mockSpan as any).name = 'http.request';

      processor.onStart(mockSpan as Span);

      expect(mockSpan.setAttribute).not.toHaveBeenCalled();
    });

    it('handles spans with empty names', () => {
      (mockSpan as any).name = '';

      expect(() => processor.onStart(mockSpan as Span)).not.toThrow();
      expect(mockSpan.setAttribute).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without throwing', () => {
      (mockSpan as any).name = 'ai.streamText';
      mockSpan.setAttribute = vi.fn(() => {
        throw new Error('setAttribute failed');
      });

      // Should not throw - errors are caught and silently handled
      expect(() => processor.onStart(mockSpan as Span)).not.toThrow();
    });

    it('processes all supported AI SDK span types', () => {
      const testCases = [
        { name: 'ai.generateText', expectedType: 'llm' },
        { name: 'ai.streamText', expectedType: 'llm' },
        { name: 'ai.generateObject', expectedType: 'llm' },
        { name: 'ai.streamObject', expectedType: 'llm' },
        { name: 'ai.generateText.doGenerate', expectedType: 'llm' },
        { name: 'ai.streamText.doStream', expectedType: 'llm' },
        { name: 'ai.generateObject.doGenerate', expectedType: 'llm' },
        { name: 'ai.streamObject.doStream', expectedType: 'llm' },
        { name: 'ai.toolCall', expectedType: 'tool' },
        { name: 'ai.embed', expectedType: 'component' },
        { name: 'ai.embedMany', expectedType: 'component' },
        { name: 'ai.embed.doEmbed', expectedType: 'component' },
        { name: 'ai.embedMany.doEmbed', expectedType: 'component' },
      ];

      testCases.forEach(({ name, expectedType }) => {
        const span = {
          name,
          setAttribute: vi.fn(),
          setAttributes: vi.fn(),
        };

        processor.onStart(span as any);

        expect(span.setAttribute).toHaveBeenCalledWith('langwatch.span.type', expectedType);
      });
    });
  });

  describe('onEnd', () => {
    let mockReadableSpan: Partial<ReadableSpan>;

    beforeEach(() => {
      mockReadableSpan = {
        name: '',
        attributes: {},
        status: { code: SpanStatusCode.OK },
      };
    });

    it('ignores non-AI SDK spans', () => {
      (mockReadableSpan as any).name = 'http.request';

      // Should not throw or log errors
      expect(() => processor.onEnd(mockReadableSpan as ReadableSpan)).not.toThrow();
    });

    it('processes AI SDK spans without errors', () => {
      (mockReadableSpan as any).name = 'ai.streamText';
      (mockReadableSpan as any).attributes = {
        'langwatch.span.type': 'llm',
      };

      expect(() => processor.onEnd(mockReadableSpan as ReadableSpan)).not.toThrow();
    });

    it('handles errors gracefully', () => {
      (mockReadableSpan as any).name = 'ai.streamText';
      // Trigger error by making attributes throw
      Object.defineProperty(mockReadableSpan, 'attributes', {
        get: () => {
          throw new Error('attributes access failed');
        }
      });

      // Should not throw - errors are caught and silently handled
      expect(() => processor.onEnd(mockReadableSpan as ReadableSpan)).not.toThrow();
    });

    it('handles successful spans', () => {
      (mockReadableSpan as any).name = 'ai.generateText';
      (mockReadableSpan as any).attributes = {
        'langwatch.span.type': 'llm',
      };
      (mockReadableSpan as any).status = { code: SpanStatusCode.OK };

      expect(() => processor.onEnd(mockReadableSpan as ReadableSpan)).not.toThrow();
    });

    it('handles error spans', () => {
      (mockReadableSpan as any).name = 'ai.streamText';
      (mockReadableSpan as any).attributes = {
        'langwatch.span.type': 'llm',
      };
      (mockReadableSpan as any).status = { code: SpanStatusCode.ERROR };

      expect(() => processor.onEnd(mockReadableSpan as ReadableSpan)).not.toThrow();
    });
  });

  describe('forceFlush', () => {
    it('resolves successfully', async () => {
      await expect(processor.forceFlush()).resolves.toBeUndefined();
    });

    it('does not throw errors', async () => {
      await expect(processor.forceFlush()).resolves.not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('resolves successfully', async () => {
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });

    it('does not throw errors', async () => {
      await expect(processor.shutdown()).resolves.not.toThrow();
    });
  });

  describe('edge cases and error handling', () => {
    it('handles null span name gracefully', () => {
      const span = {
        name: null as any,
        setAttribute: vi.fn(),
      };

      expect(() => processor.onStart(span as any)).not.toThrow();
    });

    it('handles undefined span name gracefully', () => {
      const span = {
        name: undefined as any,
        setAttribute: vi.fn(),
      };

      expect(() => processor.onStart(span as any)).not.toThrow();
    });

    it('handles span names that start with "ai" but are not "ai."', () => {
      const span = {
        name: 'airflow.task',
        setAttribute: vi.fn(),
      };

      processor.onStart(span as any);

      // Should not process spans that don't start with exactly "ai."
      expect(span.setAttribute).not.toHaveBeenCalled();
    });

    it('handles case-sensitive span names', () => {
      const span = {
        name: 'AI.streamText', // Wrong case
        setAttribute: vi.fn(),
      };

      processor.onStart(span as any);

      // Should not process - prefix check is case-sensitive
      expect(span.setAttribute).not.toHaveBeenCalled();
    });

    it('processes spans with ai. prefix and complex suffixes', () => {
      const span = {
        name: 'ai.custom.deeply.nested.operation',
        setAttribute: vi.fn(),
      };

      processor.onStart(span as any);

      // Should process and default to llm type
      expect(span.setAttribute).toHaveBeenCalledWith('langwatch.span.type', 'llm');
    });
  });
});

describe('Helper Functions', () => {
  describe('isAISDKSpan', () => {
    it('returns true for AI SDK spans', () => {
      expect(isAISDKSpan('ai.streamText')).toBe(true);
      expect(isAISDKSpan('ai.generateText')).toBe(true);
      expect(isAISDKSpan('ai.toolCall')).toBe(true);
      expect(isAISDKSpan('ai.embed')).toBe(true);
    });

    it('returns false for non-AI SDK spans', () => {
      expect(isAISDKSpan('http.request')).toBe(false);
      expect(isAISDKSpan('database.query')).toBe(false);
      expect(isAISDKSpan('langchain.llm')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isAISDKSpan('')).toBe(false);
    });

    it('handles case-sensitive matching', () => {
      expect(isAISDKSpan('AI.streamText')).toBe(false);
      expect(isAISDKSpan('Ai.generateText')).toBe(false);
    });

    it('handles spans starting with "ai" but not "ai."', () => {
      expect(isAISDKSpan('airflow.task')).toBe(false);
      expect(isAISDKSpan('airline.booking')).toBe(false);
    });

    it('handles malformed input gracefully', () => {
      expect(isAISDKSpan(null as any)).toBe(false);
      expect(isAISDKSpan(undefined as any)).toBe(false);
    });
  });

  describe('getAISDKSpanType', () => {
    it('returns correct type for known span names', () => {
      expect(getAISDKSpanType('ai.streamText')).toBe('llm');
      expect(getAISDKSpanType('ai.generateText')).toBe('llm');
      expect(getAISDKSpanType('ai.toolCall')).toBe('tool');
      expect(getAISDKSpanType('ai.embed')).toBe('component');
    });

    it('defaults to llm for unknown AI SDK spans', () => {
      expect(getAISDKSpanType('ai.unknownOperation')).toBe('llm');
      expect(getAISDKSpanType('ai.futureFeature')).toBe('llm');
    });

    it('returns llm for non-AI SDK spans (fallback)', () => {
      expect(getAISDKSpanType('http.request')).toBe('llm');
      expect(getAISDKSpanType('')).toBe('llm');
    });

    it('handles all supported span types', () => {
      const testCases = [
        { name: 'ai.generateText', expectedType: 'llm' },
        { name: 'ai.streamText', expectedType: 'llm' },
        { name: 'ai.generateObject', expectedType: 'llm' },
        { name: 'ai.streamObject', expectedType: 'llm' },
        { name: 'ai.generateText.doGenerate', expectedType: 'llm' },
        { name: 'ai.streamText.doStream', expectedType: 'llm' },
        { name: 'ai.generateObject.doGenerate', expectedType: 'llm' },
        { name: 'ai.streamObject.doStream', expectedType: 'llm' },
        { name: 'ai.toolCall', expectedType: 'tool' },
        { name: 'ai.embed', expectedType: 'component' },
        { name: 'ai.embedMany', expectedType: 'component' },
        { name: 'ai.embed.doEmbed', expectedType: 'component' },
        { name: 'ai.embedMany.doEmbed', expectedType: 'component' },
      ];

      testCases.forEach(({ name, expectedType }) => {
        expect(getAISDKSpanType(name)).toBe(expectedType);
      });
    });
  });

  describe('getSupportedAISDKSpans', () => {
    it('returns array of supported span names', () => {
      const supportedSpans = getSupportedAISDKSpans();

      expect(Array.isArray(supportedSpans)).toBe(true);
      expect(supportedSpans.length).toBeGreaterThan(0);
    });

    it('includes all major AI SDK operations', () => {
      const supportedSpans = getSupportedAISDKSpans();

      expect(supportedSpans).toContain('ai.streamText');
      expect(supportedSpans).toContain('ai.generateText');
      expect(supportedSpans).toContain('ai.toolCall');
      expect(supportedSpans).toContain('ai.embed');
    });

    it('includes provider-level operations', () => {
      const supportedSpans = getSupportedAISDKSpans();

      expect(supportedSpans).toContain('ai.generateText.doGenerate');
      expect(supportedSpans).toContain('ai.streamText.doStream');
    });

    it('returns exactly 13 supported spans', () => {
      const supportedSpans = getSupportedAISDKSpans();

      // Verify we have the expected number of supported span types
      expect(supportedSpans.length).toBe(13);
    });

    it('returns unique span names', () => {
      const supportedSpans = getSupportedAISDKSpans();
      const uniqueSpans = new Set(supportedSpans);

      expect(supportedSpans.length).toBe(uniqueSpans.size);
    });

    it('returns consistent results on multiple calls', () => {
      const first = getSupportedAISDKSpans();
      const second = getSupportedAISDKSpans();

      expect(first).toEqual(second);
    });
  });

  describe('data validation', () => {
    it('validates all helper functions work together', () => {
      const supportedSpans = getSupportedAISDKSpans();

      supportedSpans.forEach(spanName => {
        // All supported spans should be detected as AI SDK spans
        expect(isAISDKSpan(spanName)).toBe(true);

        // All supported spans should return a valid type
        const type = getAISDKSpanType(spanName);
        expect(['llm', 'tool', 'component']).toContain(type);
      });
    });

    it('handles various input types safely', () => {
      // Should not throw on edge cases
      expect(() => isAISDKSpan('' as any)).not.toThrow();
      expect(() => getAISDKSpanType('' as any)).not.toThrow();
      expect(() => getSupportedAISDKSpans()).not.toThrow();
    });
  });
});
