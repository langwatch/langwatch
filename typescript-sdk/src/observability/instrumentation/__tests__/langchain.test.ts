// --- Mock setup (must be at the top for Vitest hoisting) ---
const { mockSpan, mockTracer } = vi.hoisted(() => {
  const calls: any = { setType: [], setInput: [], setOutput: [], setAttributes: [], setRequestModel: [], setOutputString: [], setInputString: [], addEvent: [], recordException: [], setStatus: [], end: 0 };
  const span = {
    setType: vi.fn(function (this: any, ...args) { calls.setType.push(args); return this; }),
    setInput: vi.fn(function (this: any, ...args) { calls.setInput.push(args); return this; }),
    setOutput: vi.fn(function (this: any, ...args) { calls.setOutput.push(args); return this; }),
    setAttributes: vi.fn(function (this: any, ...args) { calls.setAttributes.push(args); return this; }),
    setRequestModel: vi.fn(function (this: any, ...args) { calls.setRequestModel.push(args); return this; }),
    setOutputString: vi.fn(function (this: any, ...args) { calls.setOutputString.push(args); return this; }),
    setInputString: vi.fn(function (this: any, ...args) { calls.setInputString.push(args); return this; }),
    addEvent: vi.fn(function (this: any, ...args) { calls.addEvent.push(args); return this; }),
    recordException: vi.fn((...args) => { calls.recordException.push(args); }),
    setStatus: vi.fn(function (this: any, ...args) { calls.setStatus.push(args); return this; }),
    end: vi.fn(() => { calls.end++; }),
    setRAGContexts: vi.fn(function (this: any, ...args) { return this; }),
    setRAGContext: vi.fn(function (this: any, ...args) { return this; }),
    setResponseModel: vi.fn(function (this: any, ...args) { return this; }),
    setMetrics: vi.fn(function (this: any, ...args) { return this; }),
    setOutputEvaluation: vi.fn(function (this: any, ...args) { return this; }),
    recordEvaluation: vi.fn(function (this: any, ...args) { return this; }),
    addGenAISystemMessageEvent: vi.fn(function (this: any, ...args) { return this; }),
    addGenAIUserMessageEvent: vi.fn(function (this: any, ...args) { return this; }),
    addGenAIAssistantMessageEvent: vi.fn(function (this: any, ...args) { return this; }),
    addGenAIToolMessageEvent: vi.fn(function (this: any, ...args) { return this; }),
    addGenAIChoiceEvent: vi.fn(function (this: any, ...args) { return this; }),
    spanContext: vi.fn(() => ({ traceId: 'trace', spanId: 'span', traceFlags: 1 })),
    setAttribute: vi.fn(function (this: any, ...args) { return this; }),
    addLink: vi.fn(function (this: any, ...args) { return this; }),
    addLinks: vi.fn(function (this: any, ...args) { return this; }),
    updateName: vi.fn(function (this: any, ...args) { return this; }),
    isRecording: vi.fn(),
    calls,
  };
  const tracer = {
    startSpan: vi.fn(() => span),
    startActiveSpan: vi.fn(() => span),
    withActiveSpan: vi.fn(async (...args: any[]) => {
      // Find the function argument (should be the last argument)
      const fnIndex = args.findIndex((arg) => typeof arg === "function");
      if (fnIndex === -1) {
        throw new Error("withActiveSpan requires a function as the last argument");
      }
      const userFn = args[fnIndex] as (span: any) => any;
      return await userFn(span);
    }) as any,
  };
  return { mockSpan: span, mockTracer: tracer };
});

vi.mock('../../trace', () => ({
  getLangWatchTracer: vi.fn(() => mockTracer),
}));

vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<any>('@opentelemetry/api');
  return {
    ...actual,
    context: {
      ...actual.context,
      active: vi.fn(() => ({})),
    },
    trace: {
      ...actual.trace,
      setSpan: vi.fn((_ctx, span) => span),
    },
    SpanStatusCode: { ERROR: 'ERROR' },
  };
});

vi.mock('../../client', () => ({
  canAutomaticallyCaptureInput: () => true,
  canAutomaticallyCaptureOutput: () => true,
}));

// --- Imports (must be after mocks for Vitest hoisting) ---
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LangWatchCallbackHandler, convertFromLangChainMessages } from '../langchain';

// --- Tests ---
describe('LangWatchCallbackHandler', () => {
  let handler: LangWatchCallbackHandler;

  beforeEach(() => {
    handler = new LangWatchCallbackHandler();
    handler.tracer = mockTracer;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('can be constructed', () => {
    expect(handler).toBeInstanceOf(LangWatchCallbackHandler);
  });

  it('handleLLMStart creates a span and sets input/attributes', async () => {
    const serializedMock = { lc: 1, type: 'constructor', id: ['llm', 'test'], kwargs: {} } as import('@langchain/core/load/serializable').SerializedConstructor;
    await handler.handleLLMStart(
      serializedMock,
      ['prompt1', 'prompt2'],
      'run1',
      undefined,
      { temperature: 0.7 },
      ['tag1'],
      { ls_model_name: 'gpt-4', foo: 'bar' },
      'llmName',
    );
    expect(mockTracer.startSpan).toHaveBeenCalledWith('llmName', {}, expect.anything());
    expect(mockSpan.setType).toHaveBeenCalledWith('llm');
    expect(mockSpan.setInput).toHaveBeenCalledWith(['prompt1', 'prompt2']);
    expect(mockSpan.setRequestModel).toHaveBeenCalledWith('gpt-4');
    expect(mockSpan.setAttributes).toHaveBeenCalled();
    expect(handler.spans['run1']).toBe(mockSpan);
  });

  it('handleLLMEnd sets output and ends span', async () => {
    handler.spans['run2'] = mockSpan;
    await handler.handleLLMEnd(
      { generations: [[{ text: 'output1' }], [{ text: 'output2' }]] },
      'run2',
    );
    expect(mockSpan.setOutput).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['run2']).toBeUndefined();
  });

  it('handleLLMError records exception, sets error status, and ends span', async () => {
    handler.spans['run3'] = mockSpan;
    const error = new Error('fail');
    await handler.handleLLMError(error, 'run3');
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'fail' });
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['run3']).toBeUndefined();
  });

  it('handleChainStart creates a span and sets input', async () => {
    const serializedMock = { lc: 1, type: 'constructor', id: ['chain', 'test'], kwargs: {} } as import('@langchain/core/load/serializable').SerializedConstructor;
    const inputs = { foo: 'bar' };
    await handler.handleChainStart(
      serializedMock,
      inputs,
      'chainRun1',
      undefined,
      undefined,
      undefined,
      undefined,
      'chainName',
    );
    expect(mockTracer.startSpan).toHaveBeenCalledWith('chainName', {}, expect.anything());
    expect(mockSpan.setType).toHaveBeenCalledWith('chain');
    expect(mockSpan.setInput).toHaveBeenCalledWith(inputs);
    expect(handler.spans['chainRun1']).toBe(mockSpan);
  });

  it('handleChainEnd sets output and ends span', async () => {
    handler.spans['chainRun2'] = mockSpan;
    const output = { result: 'done' };
    await handler.handleChainEnd(output, 'chainRun2');
    expect(mockSpan.setOutput).toHaveBeenCalledWith(output);
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['chainRun2']).toBeUndefined();
  });

  it('handleChainError records exception, sets error status, and ends span', async () => {
    handler.spans['chainRun3'] = mockSpan;
    const error = new Error('chain fail');
    await handler.handleChainError(error, 'chainRun3');
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'chain fail' });
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['chainRun3']).toBeUndefined();
  });

  it('handleToolStart creates a span and sets input string', async () => {
    const serializedMock = { lc: 1, type: 'constructor', id: ['tool', 'test'], kwargs: {} } as import('@langchain/core/load/serializable').SerializedConstructor;
    await handler.handleToolStart(
      serializedMock,
      'tool input',
      'toolRun1',
      undefined,
      ['tag1'],
      { meta: 'data' },
      'toolName',
    );
    expect(mockTracer.startSpan).toHaveBeenCalledWith('toolName', {}, expect.anything());
    expect(mockSpan.setType).toHaveBeenCalledWith('tool');
    expect(mockSpan.setInputString).toHaveBeenCalledWith('tool input');
    expect(mockSpan.setAttributes).toHaveBeenCalled();
    expect(handler.spans['toolRun1']).toBe(mockSpan);
  });

  it('handleToolEnd sets output string and ends span', async () => {
    handler.spans['toolRun2'] = mockSpan;
    await handler.handleToolEnd('tool output', 'toolRun2');
    expect(mockSpan.setOutputString).toHaveBeenCalledWith('tool output');
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['toolRun2']).toBeUndefined();
  });

  it('handleToolError records exception, sets error status, and ends span', async () => {
    handler.spans['toolRun3'] = mockSpan;
    const error = new Error('tool fail');
    await handler.handleToolError(error, 'toolRun3');
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'tool fail' });
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['toolRun3']).toBeUndefined();
  });

  it('handleRetrieverStart creates a span and sets input string', async () => {
    const serializedMock = { lc: 1, type: 'constructor', id: ['retriever', 'test'], kwargs: {} } as import('@langchain/core/load/serializable').SerializedConstructor;
    await handler.handleRetrieverStart(
      serializedMock,
      'retriever query',
      'retrieverRun1',
      undefined,
      ['tag1'],
      { meta: 'data' },
      'retrieverName',
    );
    expect(mockTracer.startSpan).toHaveBeenCalledWith('retrieverName', {}, expect.anything());
    expect(mockSpan.setType).toHaveBeenCalledWith('rag');
    expect(mockSpan.setInputString).toHaveBeenCalledWith('retriever query');
    expect(mockSpan.setAttributes).toHaveBeenCalled();
    expect(handler.spans['retrieverRun1']).toBe(mockSpan);
  });

  it('handleRetrieverEnd sets output, RAG contexts, and ends span', async () => {
    handler.spans['retrieverRun2'] = mockSpan;
    const docs = [
      { metadata: { id: 'doc1', chunk_id: 'chunk1' }, pageContent: 'content1' },
      { metadata: { id: 'doc2', chunk_id: 'chunk2' }, pageContent: 'content2' },
    ];
    await handler.handleRetrieverEnd(docs as any, 'retrieverRun2');
    expect(mockSpan.setOutput).toHaveBeenCalledWith(docs);
    expect(mockSpan.setRAGContexts).toHaveBeenCalledWith([
      { document_id: 'doc1', chunk_id: 'chunk1', content: 'content1' },
      { document_id: 'doc2', chunk_id: 'chunk2', content: 'content2' },
    ]);
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['retrieverRun2']).toBeUndefined();
  });

  it('handleRetrieverError records exception, sets error status, and ends span', async () => {
    handler.spans['retrieverRun3'] = mockSpan;
    const error = new Error('retriever fail');
    await handler.handleRetrieverError(error, 'retrieverRun3');
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'retriever fail' });
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['retrieverRun3']).toBeUndefined();
  });

  it('handleAgentAction adds event and sets type', async () => {
    handler.spans['agentRun1'] = mockSpan;
    await handler.handleAgentAction({} as any, 'agentRun1');
    expect(mockSpan.setType).toHaveBeenCalledWith('agent');
  });

  it('handleAgentEnd sets output, ends span, and cleans up', async () => {
    handler.spans['agentRun2'] = mockSpan;
    const action = { returnValues: { foo: 'bar' } };
    await handler.handleAgentEnd(action as any, 'agentRun2');
    expect(mockSpan.setOutput).toHaveBeenCalledWith(action.returnValues);
    expect(mockSpan.end).toHaveBeenCalled();
    expect(handler.spans['agentRun2']).toBeUndefined();
  });

  it('convertFromLangChainMessages converts messages to expected format', () => {
    const messages = [
      { content: 'hi', type: 'human', lc_serializable: false },
      { content: 'hello', type: 'ai', lc_serializable: false },
    ];
    const result = convertFromLangChainMessages(messages as any);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[0].content).toBe('hi');
    expect(result[1].content).toBe('hello');
  });
});
