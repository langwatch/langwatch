vi.mock('../../evaluation/record-evaluation', () => ({
  recordEvaluation: vi.fn(),
}));

import { createLangWatchSpan } from '../span';
import { recordEvaluation } from '../../evaluation/record-evaluation';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeMockSpan = () => {
  const calls: any = { addEvent: [], setAttribute: [], end: 0, setAttributes: [], recordException: [] };
  return {
    addEvent: vi.fn((...args) => { calls.addEvent.push(args); }),
    setAttribute: vi.fn((...args) => { calls.setAttribute.push(args); }),
    setAttributes: vi.fn((...args) => { calls.setAttributes.push(args); }),
    end: vi.fn(() => { calls.end++; }),
    recordException: vi.fn((...args) => { calls.recordException.push(args); }),
    calls,
    someOriginalMethod: vi.fn(() => 'original'),
  };
};

describe('createLangWatchSpan', () => {
  let span: ReturnType<typeof makeMockSpan>;
  let lwSpan: ReturnType<typeof createLangWatchSpan>;
  let intSemconv: any;
  let semconv: any;

  beforeEach(async () => {
    span = makeMockSpan();
    lwSpan = createLangWatchSpan(span as any);
    intSemconv = await import('../semconv/index.js');
    semconv = await import('@opentelemetry/semantic-conventions/incubating');
  });

  it('setType sets the span type attribute', () => {
    lwSpan.setType('llm');
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_SPAN_TYPE, 'llm');
  });

  it('setRequestModel sets the request model attribute', () => {
    lwSpan.setRequestModel('gpt-4');
    expect(span.setAttribute).toHaveBeenCalledWith(semconv.ATTR_GEN_AI_REQUEST_MODEL, 'gpt-4');
  });

  it('setResponseModel sets the response model attribute', () => {
    lwSpan.setResponseModel('gpt-4');
    expect(span.setAttribute).toHaveBeenCalledWith(semconv.ATTR_GEN_AI_RESPONSE_MODEL, 'gpt-4');
  });

  it('setRAGContexts sets the rag contexts attribute as JSON', () => {
    const ctxs = [{ document_id: 'd', chunk_id: 'c', content: 'x' }];
    lwSpan.setRAGContexts(ctxs);
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS, JSON.stringify({ type: 'json', value: ctxs }));
  });

  it('setRAGContext sets a single rag context as JSON array', () => {
    const ctx = { document_id: 'd', chunk_id: 'c', content: 'x' };
    lwSpan.setRAGContext(ctx);
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_RAG_CONTEXTS, JSON.stringify({ type: 'json', value: [ctx] }));
  });

  it('setMetrics sets the metrics attribute as JSON', () => {
    const metrics = { promptTokens: 1, completionTokens: 2, cost: 3 };
    lwSpan.setMetrics(metrics);
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_METRICS, JSON.stringify({ type: 'json', value: metrics }));
  });

  it('setInput sets the input attribute as JSON', () => {
    lwSpan.setInput({ foo: 'bar' });
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_INPUT, JSON.stringify({ type: 'json', value: { foo: 'bar' } }));
  });

  it('setInputString sets the input attribute as text', () => {
    lwSpan.setInputString('prompt');
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_INPUT, JSON.stringify({ type: 'text', value: 'prompt' }));
  });

  it('setOutput sets the output attribute as JSON', () => {
    lwSpan.setOutput({ foo: 'bar' });
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_OUTPUT, JSON.stringify({ type: 'json', value: { foo: 'bar' } }));
  });

  it('setOutputString sets the output attribute as text', () => {
    lwSpan.setOutputString('completion');
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_OUTPUT, JSON.stringify({ type: 'text', value: 'completion' }));
  });

  it('setOutputEvaluation sets the output attribute as guardrail/evaluation result', () => {
    lwSpan.setOutputEvaluation(true, { status: 'processed', passed: true });
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_OUTPUT, JSON.stringify({ type: 'guardrail_result', value: { status: 'processed', passed: true } }));
    lwSpan.setOutputEvaluation(false, { status: 'processed', passed: false });
    expect(span.setAttribute).toHaveBeenCalledWith(intSemconv.ATTR_LANGWATCH_OUTPUT, JSON.stringify({ type: 'evaluation_result', value: { status: 'processed', passed: false } }));
  });

  it('addGenAISystemMessageEvent sets default role and adds event', () => {
    lwSpan.addGenAISystemMessageEvent({ content: 'hi' });
    expect(span.addEvent).toHaveBeenCalledWith(intSemconv.LOG_EVNT_GEN_AI_SYSTEM_MESSAGE, expect.objectContaining({
      [semconv.ATTR_GEN_AI_SYSTEM]: undefined,
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify({ content: 'hi', role: 'system' }),
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
    }));
  });

  it('addGenAIUserMessageEvent sets default role and adds event', () => {
    lwSpan.addGenAIUserMessageEvent({ content: 'hi' });
    expect(span.addEvent).toHaveBeenCalledWith(intSemconv.LOG_EVNT_GEN_AI_USER_MESSAGE, expect.objectContaining({
      [semconv.ATTR_GEN_AI_SYSTEM]: undefined,
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify({ content: 'hi', role: 'user' }),
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
    }));
  });

  it('addGenAIAssistantMessageEvent sets default role and adds event', () => {
    lwSpan.addGenAIAssistantMessageEvent({ content: 'hi' });
    expect(span.addEvent).toHaveBeenCalledWith(intSemconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE, expect.objectContaining({
      [semconv.ATTR_GEN_AI_SYSTEM]: undefined,
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify({ content: 'hi', role: 'assistant' }),
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
    }));
  });

  it('addGenAIToolMessageEvent sets default role and adds event', () => {
    lwSpan.addGenAIToolMessageEvent({ content: 'hi', id: 't1' });
    expect(span.addEvent).toHaveBeenCalledWith(intSemconv.LOG_EVNT_GEN_AI_TOOL_MESSAGE, expect.objectContaining({
      [semconv.ATTR_GEN_AI_SYSTEM]: undefined,
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify({ content: 'hi', id: 't1', role: 'tool' }),
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
    }));
  });

  it('addGenAIChoiceEvent sets default message.role and adds event', () => {
    lwSpan.addGenAIChoiceEvent({ finish_reason: 'stop', index: 0, message: { content: 'x' } });
    expect(span.addEvent).toHaveBeenCalledWith(intSemconv.LOG_EVNT_GEN_AI_CHOICE, expect.objectContaining({
      [semconv.ATTR_GEN_AI_SYSTEM]: undefined,
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_BODY]: JSON.stringify({ finish_reason: 'stop', index: 0, message: { content: 'x', role: 'assistant' } }),
      [intSemconv.ATTR_LANGWATCH_GEN_AI_LOG_EVENT_IMPOSTER]: true,
    }));
  });

  it('recordEvaluation calls recordEvaluation util', () => {
    const details = { name: 'eval', status: 'processed' as const };
    const attributes = { foo: 'bar' };
    const span = makeMockSpan();
    const lwSpan2 = createLangWatchSpan(span as any);
    lwSpan2.recordEvaluation(details, attributes);
    expect(recordEvaluation).toHaveBeenCalledWith(details, attributes);
  });

  it('forwards unknown methods to the original span', () => {
    expect((lwSpan as any).someOriginalMethod()).toBe('original');
  });
});
