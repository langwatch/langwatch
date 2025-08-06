import { describe, it, expect } from 'vitest';
import { LangWatchCallbackHandler, convertFromLangChainMessages } from '..';

describe('LangWatchCallbackHandler', () => {
  describe('message conversion', () => {
    it('converts standard langchain message types', () => {
      const messages = [
        { content: 'Hello', type: 'human', lc_serializable: false },
        { content: 'Hi there!', type: 'ai', lc_serializable: false },
        { content: 'System prompt', type: 'system', lc_serializable: false },
        { content: 'Function result', type: 'function', lc_serializable: false },
        { content: 'Tool output', type: 'tool', lc_serializable: false }
      ];

      const result = convertFromLangChainMessages(messages as any);

      expect(result).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'system', content: 'System prompt' },
        { role: 'function', content: 'Function result' },
        { role: 'tool', content: 'Tool output' }
      ]);
    });

    it('handles empty message array', () => {
      const result = convertFromLangChainMessages([]);
      expect(result).toEqual([]);
    });

    it('defaults unknown message types to user role', () => {
      const messages = [
        { content: 'Unknown', type: 'unknown', lc_serializable: false }
      ];

      const result = convertFromLangChainMessages(messages as any);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user'); // Should default to user
      expect(result[0].content).toBe('Unknown');
    });

    it('handles complex message content (arrays)', () => {
      const messages = [
        {
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
          ],
          type: 'human',
          lc_serializable: false
        }
      ];

      const result = convertFromLangChainMessages(messages as any);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toEqual([
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
      ]);
    });

    it('handles function_call in additional_kwargs', () => {
      const messages = [
        {
          content: 'Call function',
          type: 'ai',
          lc_serializable: false,
          additional_kwargs: { name: 'test_function', arguments: '{"arg": "value"}' }
        }
      ];

      const result = convertFromLangChainMessages(messages as any);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].function_call).toEqual({ name: 'test_function', arguments: '{"arg": "value"}' });
    });

    it('handles malformed content gracefully', () => {
      const messages = [
        {
          content: [{ type: 'unknown', data: 'something' }],
          type: 'human',
          lc_serializable: false
        }
      ];

      // Should not throw
      expect(() => convertFromLangChainMessages(messages as any)).not.toThrow();
    });

    it('handles null and undefined values', () => {
      const messages = [
        { content: null, type: 'human', lc_serializable: false },
        { content: undefined, type: 'ai', lc_serializable: false }
      ];

      // Should not throw and return valid results
      const result = convertFromLangChainMessages(messages as any);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });
  });

  describe('constructor', () => {
    it('creates instance without throwing', () => {
      expect(() => new LangWatchCallbackHandler()).not.toThrow();
    });

    it('creates instance with correct name', () => {
      const handler = new LangWatchCallbackHandler();
      expect(handler.name).toBe('LangWatchCallbackHandler');
    });

    it('initializes empty spans object', () => {
      const handler = new LangWatchCallbackHandler();
      expect(handler.spans).toEqual({});
    });

    it('has tracer property', () => {
      const handler = new LangWatchCallbackHandler();
      expect(handler.tracer).toBeDefined();
    });
  });

  describe('span management', () => {
    it('handles missing spans gracefully', () => {
      const handler = new LangWatchCallbackHandler();

      // These methods should not throw when span doesn't exist
      expect(async () => {
        await handler.handleLLMEnd({ generations: [[]] }, 'nonexistent');
        await handler.handleLLMError(new Error('test'), 'nonexistent');
        await handler.handleChainEnd({}, 'nonexistent');
        await handler.handleChainError(new Error('test'), 'nonexistent');
        await handler.handleToolEnd('output', 'nonexistent');
        await handler.handleToolError(new Error('test'), 'nonexistent');
      }).not.toThrow();
    });
  });

  describe('error scenarios', () => {
    it('handles malformed serialized objects', () => {
      const handler = new LangWatchCallbackHandler();

      const malformedSerialized = { invalid: 'object' };

      // Should not throw even with malformed data
      expect(async () => {
        await handler.handleLLMStart(
          malformedSerialized as any,
          ['test'],
          'test-run',
          undefined,
          {},
          [],
          {},
          'test'
        );
      }).not.toThrow();
    });

    it('handles null/undefined parameters', () => {
      const handler = new LangWatchCallbackHandler();

      // Should handle null/undefined gracefully
      expect(async () => {
        await handler.handleLLMStart(
          {} as any,
          null as any,
          'test-run',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        );
      }).not.toThrow();
    });

    it('handles circular references in metadata', () => {
      const handler = new LangWatchCallbackHandler();

      const circular: any = { name: 'test' };
      circular.self = circular;

      // Should not throw on circular references
      expect(async () => {
        await handler.handleLLMStart(
          {} as any,
          ['test'],
          'test-run',
          undefined,
          { circular },
          [],
          {},
          'test'
        );
      }).not.toThrow();
    });
  });

  describe('data validation', () => {
    it('handles various LLMResult formats', () => {
      const handler = new LangWatchCallbackHandler();

      const testCases = [
        // Empty generations
        { generations: [] },
        // Text generations
        { generations: [[{ text: 'response' }]] },
        // Message generations
        { generations: [[{ message: { content: 'response', type: 'ai' } }]] },
        // Mixed generations
        { generations: [[{ text: 'text' }, { message: { content: 'msg', type: 'ai' } }]] },
        // Malformed generations
        { generations: [[{ unknown: 'format' }]] }
      ];

      testCases.forEach((testCase, index) => {
        expect(async () => {
          await handler.handleLLMEnd(testCase as any, `test-${index}`);
        }).not.toThrow();
      });
    });

    it('handles empty and malformed chain values', () => {
      const handler = new LangWatchCallbackHandler();

      const testCases = [
        {},
        null,
        undefined,
        { key: 'value' },
        { nested: { deep: { value: 'test' } } }
      ];

      testCases.forEach((testCase, index) => {
        expect(async () => {
          await handler.handleChainStart({} as any, testCase as any, `test-${index}`);
          await handler.handleChainEnd(testCase as any, `test-${index}`);
        }).not.toThrow();
      });
    });
  });
});
