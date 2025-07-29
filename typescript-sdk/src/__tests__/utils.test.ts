import { describe, it, expect, vi } from 'vitest';
import {
  convertFromVercelAIMessages,
  captureError,
  autoconvertTypedValues
} from '../utils';
import { type CoreMessage } from 'ai';

describe('utils', () => {
  describe('convertFromVercelAIMessages', () => {
    it('converts system messages', () => {
      const messages: CoreMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        { role: 'system', content: 'You are a helpful assistant' }
      ]);
    });

    it('converts user text messages', () => {
      const messages: CoreMessage[] = [
        { role: 'user', content: 'Hello' }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        { role: 'user', content: 'Hello' }
      ]);
    });

    it('converts user messages with text parts', () => {
      const messages: CoreMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello world' }]
        }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        { role: 'user', content: 'Hello world' }
      ]);
    });

    it('converts assistant messages', () => {
      const messages: CoreMessage[] = [
        { role: 'assistant', content: 'Hello there!' }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        { role: 'assistant', content: 'Hello there!' }
      ]);
    });

    it('converts assistant messages with tool calls', () => {
      const messages: CoreMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will help you' },
            {
              type: 'tool-call',
              toolCallId: 'call_123',
              toolName: 'get_weather',
              args: { location: 'NYC' }
            }
          ]
        }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        {
          role: 'assistant',
          content: 'I will help you',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"NYC"}'
              }
            }
          ]
        }
      ]);
    });

        it('converts tool messages', () => {
      const messages: CoreMessage[] = [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_123',
              toolName: 'get_weather',
              result: { temperature: 72 }
            }
          ]
        }
      ];
      const result = convertFromVercelAIMessages(messages);
      expect(result).toEqual([
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: '{"temperature":72}'
        }
      ]);
    });

    it('throws error for unsupported role', () => {
      const messages = [{ role: 'unknown' as any, content: 'test' }];
      expect(() => convertFromVercelAIMessages(messages)).toThrow('Unsupported role: unknown');
    });

    it('throws error for unsupported assistant part type', () => {
      const messages: CoreMessage[] = [
        {
          role: 'assistant',
          content: [{ type: 'unknown' as any, text: 'test' }]
        }
      ];
      expect(() => convertFromVercelAIMessages(messages)).toThrow('Unsupported part:');
    });
  });

  describe('captureError', () => {
    it('handles Error objects', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      const result = captureError(error);
      expect(result).toEqual({
        has_error: true,
        message: 'Test error',
        stacktrace: ['Error: Test error', '    at test.js:1:1']
      });
    });

    it('handles error-like objects', () => {
      const error = {
        message: 'Custom error',
        stack: 'CustomError: Custom error\n    at test.js:1:1'
      };

      const result = captureError(error);
      expect(result).toEqual({
        has_error: true,
        message: 'Custom error',
        stacktrace: ['CustomError: Custom error', '    at test.js:1:1']
      });
    });

    it('handles error-like objects with array stack', () => {
      const error = {
        message: 'Array stack error',
        stack: ['Error: Array stack error', '    at test.js:1:1']
      };

      const result = captureError(error);
      expect(result).toEqual({
        has_error: true,
        message: 'Array stack error',
        stacktrace: ['Error: Array stack error', '    at test.js:1:1']
      });
    });

    it('handles error-like objects with invalid stack', () => {
      const error = {
        message: 'Invalid stack error',
        stack: 123
      };

      const result = captureError(error);
      expect(result).toEqual({
        has_error: true,
        message: 'Invalid stack error',
        stacktrace: ['No stack trace available']
      });
    });

    it('handles primitive values', () => {
      const result = captureError('String error');
      expect(result).toEqual({
        has_error: true,
        message: 'String error',
        stacktrace: []
      });
    });

    it('handles null and undefined', () => {
      const nullResult = captureError(null);
      expect(nullResult).toEqual({
        has_error: true,
        message: 'null',
        stacktrace: []
      });

      const undefinedResult = captureError(undefined);
      expect(undefinedResult).toEqual({
        has_error: true,
        message: 'undefined',
        stacktrace: []
      });
    });

    it('handles ErrorCapture objects', () => {
      const errorCapture = {
        has_error: true,
        message: 'Already captured',
        stacktrace: ['line1', 'line2']
      };

      const result = captureError(errorCapture);
      expect(result).toBe(errorCapture);
    });
  });

  describe('autoconvertTypedValues', () => {
    it('converts strings to text type', () => {
      const result = autoconvertTypedValues('Hello world');
      expect(result).toEqual({
        type: 'text',
        value: 'Hello world'
      });
    });

    it('converts valid chat messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];

      const result = autoconvertTypedValues(messages);
      expect(result).toEqual({
        type: 'chat_messages',
        value: messages
      });
    });

    it('converts JSON-serializable objects', () => {
      const obj = { foo: 'bar', num: 123 };
      const result = autoconvertTypedValues(obj);
      expect(result).toEqual({
        type: 'json',
        value: obj
      });
    });

    it('converts arrays to json type', () => {
      const arr = [1, 2, 3];
      const result = autoconvertTypedValues(arr);
      expect(result).toEqual({
        type: 'json',
        value: arr
      });
    });

    it('handles non-serializable values as raw', () => {
      // Create an object with circular reference that can't be serialized
      const obj: any = { foo: 'bar' };
      obj.circular = obj;

      const result = autoconvertTypedValues(obj);
      expect(result.type).toBe('raw');
      expect(result.value).toBe(obj);
    });

    it('handles circular references as raw', () => {
      const obj: any = { foo: 'bar' };
      obj.circular = obj;

      const result = autoconvertTypedValues(obj);
      expect(result.type).toBe('raw');
    });
  });
});
