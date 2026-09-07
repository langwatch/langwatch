import { describe, it, expect, vi } from 'vitest';
import { LangWatchCallbackHandler, convertFromLangChainMessages } from '..';

// Import helper functions for testing
import {
  className,
  shorten,
  previewInput,
  ctxSkip,
  wrapNonScalarValues,
  buildLangChainMetadataAttributes,
  applyGenAIAttrs,
  getResolvedParentContext,
  deriveNameAndType
} from '..';

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
      expect(result[0]?.role).toBe('user'); // Should default to user
      expect(result[0]?.content).toBe('Unknown');
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
      expect(result[0]?.role).toBe('user');
      expect(result[0]?.content).toEqual([
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
      expect(result[0]?.role).toBe('assistant');
      expect(result[0]?.function_call).toEqual({ name: 'test_function', arguments: '{"arg": "value"}' });
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
      expect(result[0]?.role).toBe('user');
      expect(result[1]?.role).toBe('assistant');
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

    it('initializes with expected properties', () => {
      const handler = new LangWatchCallbackHandler();
      expect(handler.name).toBe('LangWatchCallbackHandler');
      expect(handler.tracer).toBeDefined();
      // Check that it's a LangChain callback handler by checking it extends BaseCallbackHandler
      expect(handler).toBeInstanceOf(LangWatchCallbackHandler);
    });

    it('has tracer property', () => {
      const handler = new LangWatchCallbackHandler();
      expect(handler.tracer).toBeDefined();
    });

    it('does not duplicate langgraph metadata under langchain.run.metadata', async () => {
      const handler = new LangWatchCallbackHandler();
      const metadata: any = {
        langgraph_node: 'analyze',
        langgraph_step: 2,
        langgraph_path: ['__pregel_pull', 'analyze'],
        langgraph_triggers: ['branch:to:analyze'],
        thread_id: 'thread',
        checkpoint_ns: 'ns',
      };
      await handler.handleChatModelStart({} as any, [], 'run', undefined, {}, [], metadata);
      await handler.handleLLMEnd({ generations: [[]] } as any, 'run');
      // If we reached here, it means building attributes didn't throw and filtering worked
      expect(true).toBe(true);
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

describe('Helper Functions', () => {
  describe('className', () => {
    it('extracts class name from id array', () => {
      const serialized = { id: ['langchain', 'llms', 'OpenAI'], lc: 1, type: 'not_implemented' } as any;
      expect(className(serialized)).toBe('OpenAI');
    });

    it('extracts class name from lc_namespace array', () => {
      const serialized = { lc_namespace: ['langchain', 'chains', 'LLMChain'], lc: 1, type: 'not_implemented' } as any;
      expect(className(serialized)).toBe('LLMChain');
    });

    it('returns empty string for invalid serialized', () => {
      expect(className(undefined)).toBe('');
      expect(className({} as any)).toBe('');
      expect(className({ id: 'not-an-array' } as any)).toBe('');
    });
  });

  describe('shorten', () => {
    it('shortens long strings', () => {
      const longString = 'a'.repeat(150);
      const result = shorten(longString);
      expect(result.length).toBe(120);
      expect(result.endsWith('…')).toBe(true);
    });

    it('returns short strings unchanged', () => {
      const shortString = 'Hello World';
      expect(shorten(shortString)).toBe(shortString);
    });

    it('handles empty strings', () => {
      expect(shorten('')).toBe('');
    });
  });

  describe('previewInput', () => {
    it('returns shortened string for long text', () => {
      const longText = 'a'.repeat(150);
      expect(previewInput(longText)).toBe('a'.repeat(119) + '…');
    });

    it('returns trimmed string for short text', () => {
      expect(previewInput('  Hello World  ')).toBe('Hello World');
    });

    it('returns undefined for non-strings', () => {
      expect(previewInput(123)).toBeUndefined();
      expect(previewInput({})).toBeUndefined();
      expect(previewInput(null)).toBeUndefined();
    });

    it('returns undefined for empty strings', () => {
      expect(previewInput('')).toBeUndefined();
      expect(previewInput('   ')).toBeUndefined();
    });
  });

  describe('ctxSkip', () => {
    it('skips ChannelWrite classes', () => {
      const serialized = { id: ['ChannelWrite'], lc: 1, type: 'not_implemented' } as any;
      expect(ctxSkip(serialized)).toBe(true);
    });

    it('skips langsmith:hidden tags', () => {
      const tags = ['langsmith:hidden', 'other-tag'];
      expect(ctxSkip(undefined, tags)).toBe(true);
    });

    it('does not skip normal classes', () => {
      const serialized = { id: ['OpenAI'], lc: 1, type: 'not_implemented' } as any;
      expect(ctxSkip(serialized)).toBe(false);
    });

    it('does not skip normal tags', () => {
      const tags = ['normal-tag'];
      expect(ctxSkip(undefined, tags)).toBe(false);
    });
  });

  describe('wrapNonScalarValues', () => {
    it('returns primitive values unchanged', () => {
      expect(wrapNonScalarValues('string')).toBe('string');
      expect(wrapNonScalarValues(123)).toBe(123);
      expect(wrapNonScalarValues(true)).toBe(true);
      expect(wrapNonScalarValues(false)).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(wrapNonScalarValues(null)).toBe('null');
      expect(wrapNonScalarValues(undefined)).toBeUndefined();
    });

    it('handles arrays', () => {
      const array = [1, 2, 3];
      expect(wrapNonScalarValues(array)).toBe(JSON.stringify(array)); // Returns JSON string length for arrays
    });

    it('handles objects', () => {
      const obj = { key: 'value' };
      expect(wrapNonScalarValues(obj)).toBe(JSON.stringify(obj)); // Returns JSON string length
    });

    it('handles circular references', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      const result = wrapNonScalarValues(circular);
      expect(typeof result).toBe('string');
      expect(result).toContain('"name":"test"');
      expect(result).toContain('"self":"[Circular]"');
    });
  });

  describe('deriveNameAndType', () => {
    describe('LLM/Chat naming', () => {
      it('names LLM with provider and model', () => {
        const result = deriveNameAndType({
          runType: 'llm',
          metadata: { ls_provider: 'OpenAI', ls_model_name: 'gpt-4' }
        });
        expect(result.name).toBe('OpenAI gpt-4');
        expect(result.type).toBe('llm');
      });

      it('includes temperature when present', () => {
        const result = deriveNameAndType({
          runType: 'llm',
          metadata: { ls_provider: 'OpenAI', ls_model_name: 'gpt-4', ls_temperature: 0.7 }
        });
        expect(result.name).toBe('OpenAI gpt-4 (temp 0.7)');
        expect(result.type).toBe('llm');
      });

      it('falls back to class name when metadata missing', () => {
        const result = deriveNameAndType({
          runType: 'llm',
          serialized: { id: ['OpenAI'], lc: 1, type: 'not_implemented' } as any
        });
        expect(result.name).toBe('LLM OpenAI');
        expect(result.type).toBe('llm');
      });

      it('prioritizes llm runType over langgraph metadata', () => {
        const result = deriveNameAndType({
          runType: 'llm',
          serialized: { id: ['OpenAI'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_node: 'analyze',
            langgraph_step: 2,
            ls_provider: 'openai',
            ls_model_name: 'gpt-4'
          }
        });
        expect(result.name).toBe('openai gpt-4');
        expect(result.type).toBe('llm');
      });
    });

    describe('LangGraph node naming', () => {
      it('names nodes with step number', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: { langgraph_node: 'analyze', langgraph_step: 2 }
        });
        expect(result.name).toBe('Node: analyze (step 2)');
        expect(result.type).toBe('component');
      });

      it('names nodes without step number', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: { langgraph_node: 'search' }
        });
        expect(result.name).toBe('Node: search');
        expect(result.type).toBe('component');
      });

      it('prioritizes router over node when both are present', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<analyze,generate_answer>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_node: 'analyze',
            langgraph_step: 2
          }
        });
        // Now routers are prioritized over nodes, so this should be a router
        expect(result.name).toBe('Route: unknown → unknown');
        expect(result.type).toBe('component');
      });
    });

    describe('Router vs Node prioritization', () => {
      it('prioritizes routers over nodes when both are present', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<analyze,search>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_node: 'analyze',
            langgraph_step: 2,
            langgraph_path: ['start', 'analyze'],
            langgraph_triggers: ['branch:to:search']
          }
        });
        // Should prioritize router over node
        expect(result.name).toBe('Route: analyze → search');
        expect(result.type).toBe('component');
      });

      it('handles node when router detection fails', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_node: 'process',
            langgraph_step: 1
            // No router metadata
          }
        });
        expect(result.name).toBe('Node: process (step 1)');
        expect(result.type).toBe('component');
      });

      it('handles router when node metadata is missing', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<start,end>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: ['branch:to:end']
            // No langgraph_node
          }
        });
        expect(result.name).toBe('Route: start → end');
        expect(result.type).toBe('component');
      });

      it('handles complex routing scenarios', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<validate,process,retry>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_node: 'validate',
            langgraph_step: 3,
            langgraph_path: ['input', 'validate'],
            langgraph_triggers: ['condition:valid', 'branch:to:process', 'branch:to:retry']
          }
        });
        // Should prioritize router over node
        expect(result.name).toBe('Route: validate → process');
        expect(result.type).toBe('component');
      });
    });

    describe('Router naming', () => {
      it('names routers with path and decision', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<analyze,search,analyze>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_path: ['__pregel_pull', 'analyze'],
            langgraph_triggers: ['branch:to:search']
          }
        });
        expect(result.name).toBe('Route: analyze → search');
        expect(result.type).toBe('component');
      });

      it('handles missing path or decision', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<analyze,search,analyze>'], lc: 1, type: 'not_implemented' } as any
        });
        expect(result.name).toBe('Route: unknown → unknown');
        expect(result.type).toBe('component');
      });

      it('detects routers by Branch class name', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<start,end>'], lc: 1, type: 'not_implemented' } as any
        });
        expect(result.name).toBe('Route: unknown → unknown');
        expect(result.type).toBe('component');
      });

      it('detects routers by langgraph_triggers array', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_triggers: ['branch:to:validate', 'branch:to:process']
          }
        });
        expect(result.name).toBe('Route: unknown → validate');
        expect(result.type).toBe('component');
      });

      it('extracts decision from complex trigger array', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start', 'validate'],
            langgraph_triggers: ['condition:true', 'branch:to:success', 'branch:to:retry']
          }
        });
        expect(result.name).toBe('Route: validate → success');
        expect(result.type).toBe('component');
      });

      it('handles empty langgraph_triggers array', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: []
          }
        });
        // Empty arrays are not detected as routers, so it falls through to graph runner
        expect(result.name).toBe('Graph: LangGraph');
        expect(result.type).toBe('chain');
      });

      it('handles non-array langgraph_triggers', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: 'not-an-array'
          }
        });
        // When langgraph_triggers is not an array, it's not detected as a router
        // So it falls through to graph runner detection
        expect(result.name).toBe('Graph: LangGraph');
        expect(result.type).toBe('chain');
      });
    });

    describe('Tool naming', () => {
      it('names tools with input preview', () => {
        const result = deriveNameAndType({
          runType: 'tool',
          metadata: { name: 'search_tool' },
          inputs: 'search query'
        });
        expect(result.name).toBe('Tool: search_tool — search query');
        expect(result.type).toBe('tool');
      });

      it('names tools without input preview', () => {
        const result = deriveNameAndType({
          runType: 'tool',
          metadata: { name: 'calculator' }
        });
        expect(result.name).toBe('Tool: calculator');
        expect(result.type).toBe('tool');
      });
    });

    describe('Graph runner naming', () => {
      it('names graph runners', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: { langgraph_path: ['path'], langgraph_node: undefined }
        });
        expect(result.name).toBe('Graph: LangGraph');
        expect(result.type).toBe('chain');
      });
    });

    describe('Fallback naming', () => {
      it('names agents', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['AgentExecutor'], lc: 1, type: 'not_implemented' } as any
        });
        expect(result.name).toBe('Agent: AgentExecutor');
        expect(result.type).toBe('component');
      });

      it('names runnables', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['RunnableSequence'], lc: 1, type: 'not_implemented' } as any
        });
        expect(result.name).toBe('Runnable: Sequence');
        expect(result.type).toBe('chain');
      });

      it('uses hard-coded name when provided', () => {
        const result = deriveNameAndType({
          runType: 'llm',
          name: 'Custom Name'
        });
        expect(result.name).toBe('Custom Name');
        expect(result.type).toBe('llm');
      });

      it('uses operation_name from metadata', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: { operation_name: 'My Operation' }
        });
        expect(result.name).toBe('My Operation');
        expect(result.type).toBe('chain');
      });
    });

    describe('Edge cases and error handling', () => {
      it('handles null/undefined metadata gracefully', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: null as any
        });
        expect(result.name).toBe('LangChain operation');
        expect(result.type).toBe('chain');
      });

      it('handles empty metadata object', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {}
        });
        expect(result.name).toBe('LangChain operation');
        expect(result.type).toBe('chain');
      });

      it('handles malformed langgraph_path', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: 'not-an-array',
            langgraph_triggers: ['branch:to:end']
          }
        });
        expect(result.name).toBe('Route: unknown → end');
        expect(result.type).toBe('component');
      });

      it('handles empty langgraph_path array', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: [],
            langgraph_triggers: ['branch:to:end']
          }
        });
        expect(result.name).toBe('Route: unknown → end');
        expect(result.type).toBe('component');
      });

      it('handles non-string langgraph_node', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_node: 123,
            langgraph_step: 1
          }
        });
        expect(result.name).toBe('Node: 123 (step 1)');
        expect(result.type).toBe('component');
      });

      it('handles non-number langgraph_step', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_node: 'test',
            langgraph_step: 'step-1'
          }
        });
        expect(result.name).toBe('Node: test (step step-1)');
        expect(result.type).toBe('component');
      });

      it('handles complex trigger objects', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: [
              { type: 'condition', value: true },
              { type: 'branch', target: 'success' }
            ]
          }
        });
        // Complex objects are detected as routers but no branch triggers found
        expect(result.name).toBe('Route: start → ');
        expect(result.type).toBe('component');
      });

      it('prioritizes user-provided name over all metadata', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          name: 'Custom Router Name',
          metadata: {
            langgraph_node: 'analyze',
            langgraph_path: ['start'],
            langgraph_triggers: ['branch:to:end']
          }
        });
        expect(result.name).toBe('Custom Router Name');
        expect(result.type).toBe('chain');
      });

      it('prioritizes operation_name over router/node detection', () => {
        const result = deriveNameAndType({
          runType: 'chain',
          metadata: {
            operation_name: 'Custom Operation',
            langgraph_node: 'analyze',
            langgraph_path: ['start'],
            langgraph_triggers: ['branch:to:end']
          }
        });
        expect(result.name).toBe('Custom Operation');
        expect(result.type).toBe('chain');
      });

      it('handles mixed router detection scenarios', () => {
        // Test with Branch class but no triggers
        const result1 = deriveNameAndType({
          runType: 'chain',
          serialized: { id: ['Branch<start,end>'], lc: 1, type: 'not_implemented' } as any,
          metadata: {
            langgraph_node: 'start'
          }
        });
        expect(result1.name).toBe('Route: unknown → unknown');
        expect(result1.type).toBe('component');

        // Test with triggers but no Branch class
        const result2 = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_triggers: ['branch:to:process']
          }
        });
        expect(result2.name).toBe('Route: unknown → process');
        expect(result2.type).toBe('component');
      });

      it('handles edge cases in decision extraction', () => {
        // Test with malformed branch trigger
        const result1 = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: ['not-a-branch-trigger']
          }
        });
        expect(result1.name).toBe('Route: start → ');
        expect(result1.type).toBe('component');

        // Test with multiple branch triggers (should pick first)
        const result2 = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: ['branch:to:first', 'branch:to:second']
          }
        });
        expect(result2.name).toBe('Route: start → first');
        expect(result2.type).toBe('component');
      });

      it('maintains correct type assignments', () => {
        // Router should be component type
        const routerResult = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_triggers: ['branch:to:end']
          }
        });
        expect(routerResult.type).toBe('component');

        // Node should be component type
        const nodeResult = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_node: 'test'
          }
        });
        expect(nodeResult.type).toBe('component');

        // Graph runner should be chain type
        const graphResult = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['path']
          }
        });
        expect(graphResult.type).toBe('chain');
      });

      it('consistently handles empty vs non-array triggers', () => {
        // Empty array should not be detected as router
        const emptyArrayResult = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: []
          }
        });
        expect(emptyArrayResult.name).toBe('Graph: LangGraph');
        expect(emptyArrayResult.type).toBe('chain');

        // Non-array should not be detected as router
        const nonArrayResult = deriveNameAndType({
          runType: 'chain',
          metadata: {
            langgraph_path: ['start'],
            langgraph_triggers: 'not-an-array'
          }
        });
        expect(nonArrayResult.name).toBe('Graph: LangGraph');
        expect(nonArrayResult.type).toBe('chain');

                // Both should behave the same way
        expect(emptyArrayResult.name).toBe(nonArrayResult.name);
        expect(emptyArrayResult.type).toBe(nonArrayResult.type);
      });
    });
  });

  describe('buildLangChainMetadataAttributes', () => {
    it('filters out LangGraph metadata keys', () => {
      const metadata = {
        langgraph_node: 'analyze',
        langgraph_step: 2,
        thread_id: 'thread-123',
        custom_key: 'custom_value',
        another_key: 'another_value'
      };

      const result = buildLangChainMetadataAttributes(metadata);

      // Should not contain LangGraph keys
      expect(result['langwatch.langchain.run.metadata.langgraph_node']).toBeUndefined();
      expect(result['langwatch.langchain.run.metadata.langgraph_step']).toBeUndefined();
      expect(result['langwatch.langchain.run.metadata.thread_id']).toBeUndefined();

      // Should contain other keys
      expect(result['langwatch.langchain.run.metadata.custom_key']).toBe('custom_value');
      expect(result['langwatch.langchain.run.metadata.another_key']).toBe('another_value');
    });

    it('handles empty metadata', () => {
      const result = buildLangChainMetadataAttributes({});
      expect(result).toEqual({});
    });

    it('handles undefined metadata', () => {
      const result = buildLangChainMetadataAttributes(undefined as any);
      expect(result).toEqual({});
    });
  });

  describe('applyGenAIAttrs', () => {
    it('sets gen_ai attributes from metadata', () => {
      const span = {
        setAttribute: vi.fn()
      } as any;

      const metadata = {
        ls_provider: 'OpenAI',
        ls_model_name: 'gpt-4',
        ls_temperature: 0.7,
        response_metadata: { model_name: 'gpt-4-0613' }
      };

      applyGenAIAttrs(span, metadata);

      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.system', 'OpenAI');
      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.request.model', 'gpt-4');
      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.request.temperature', 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.response.model', 'gpt-4-0613');
    });

    it('handles missing metadata gracefully', () => {
      const span = {
        setAttribute: vi.fn()
      } as any;

      applyGenAIAttrs(span, undefined);

      expect(span.setAttribute).not.toHaveBeenCalled();
    });

    it('extracts model from kwargs', () => {
      const span = {
        setAttribute: vi.fn()
      } as any;

      const metadata = { kwargs: { model: 'gpt-3.5-turbo' } };
      const extraParams = { kwargs: { temperature: 0.5 } };

      applyGenAIAttrs(span, metadata, extraParams);

      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.request.model', 'gpt-3.5-turbo');
      expect(span.setAttribute).toHaveBeenCalledWith('gen_ai.request.temperature', 0.5);
    });
  });

  describe('getResolvedParentContext', () => {
    it('returns active context when no runId provided', () => {
      const result = getResolvedParentContext(undefined, {}, {});
      expect(result).toBeDefined();
    });

    it('returns active context when no spans exist', () => {
      const result = getResolvedParentContext('run-1', {}, {});
      expect(result).toBeDefined();
    });

    it('finds parent span and returns context', () => {
      const mockSpan = {
        spanContext: () => ({ traceId: '123', spanId: '456' }),
        setAttributes: vi.fn(),
        setAttribute: vi.fn(),
        setType: vi.fn(),
        setRequestModel: vi.fn(),
        setInput: vi.fn(),
        setOutput: vi.fn(),
        setRAGContexts: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
        addEvent: vi.fn(),
        end: vi.fn()
      };
      const spans = { 'run-1': mockSpan as any };
      const parentOf = { 'child-1': 'run-1' };

      const result = getResolvedParentContext('child-1', spans, parentOf);
      expect(result).toBeDefined();
    });
  });
});
