import { type Span, SpanStatusCode } from '@opentelemetry/api';
import {
  SAMPLE_ASSISTANT_RESPONSES,
  SAMPLE_SYSTEM_PROMPTS,
  SAMPLE_USER_MESSAGES,
  type SpanType,
  TOOL_NAMES,
  VENDORS,
} from './types.js';

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTokenCounts(): { prompt: number; completion: number } {
  const prompt = randomInt(50, 2000);
  const completion = randomInt(20, 1500);
  return { prompt, completion };
}

function calculateCost(promptTokens: number, completionTokens: number, model: string): number {
  const prices: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o': { prompt: 0.0025, completion: 0.01 },
    'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
    'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
    'claude-3-5-sonnet-20241022': { prompt: 0.003, completion: 0.015 },
    'claude-3-5-haiku-20241022': { prompt: 0.0008, completion: 0.004 },
    'claude-3-opus-20240229': { prompt: 0.015, completion: 0.075 },
    'gemini-1.5-pro': { prompt: 0.00125, completion: 0.005 },
    'gemini-1.5-flash': { prompt: 0.000075, completion: 0.0003 },
    'gemini-2.0-flash': { prompt: 0.0001, completion: 0.0004 },
  };

  const price = prices[model] ?? { prompt: 0.001, completion: 0.002 };
  return (promptTokens / 1000) * price.prompt + (completionTokens / 1000) * price.completion;
}

export interface SpanGeneratorResult {
  type: SpanType;
  name: string;
}

export function applyLLMAttributes(span: Span, spanName: string): SpanGeneratorResult {
  const vendor = randomElement(VENDORS);
  const model = randomElement(vendor.models);
  const tokens = generateTokenCounts();
  const cost = calculateCost(tokens.prompt, tokens.completion, model);

  const systemPrompt = randomElement(SAMPLE_SYSTEM_PROMPTS);
  const userMessage = randomElement(SAMPLE_USER_MESSAGES);
  const assistantResponse = randomElement(SAMPLE_ASSISTANT_RESPONSES);

  const input = {
    type: 'chat_messages',
    value: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  };

  const output = {
    type: 'chat_messages',
    value: [{ role: 'assistant', content: assistantResponse }],
  };

  span.setAttributes({
    'langwatch.span.type': 'llm',
    'langwatch.input': JSON.stringify(input),
    'langwatch.output': JSON.stringify(output),
    'langwatch.metrics': JSON.stringify({
      prompt_tokens: tokens.prompt,
      completion_tokens: tokens.completion,
      cost,
      tokens_estimated: false,
    }),
    'langwatch.params': JSON.stringify({
      temperature: Math.random() * 0.7 + 0.3,
      max_tokens: randomInt(100, 4000),
      top_p: 1,
    }),
    'gen_ai.system': vendor.name,
    'gen_ai.request.model': model,
    'gen_ai.response.model': model,
    'gen_ai.request.temperature': Math.random() * 0.7 + 0.3,
    'gen_ai.request.max_tokens': randomInt(100, 4000),
    'gen_ai.response.finish_reason': 'stop',
    'gen_ai.usage.prompt_tokens': tokens.prompt,
    'gen_ai.usage.completion_tokens': tokens.completion,
    'gen_ai.usage.total_tokens': tokens.prompt + tokens.completion,
  });

  span.setStatus({ code: SpanStatusCode.OK });

  return { type: 'llm', name: spanName };
}

export function applyChainAttributes(span: Span, spanName: string): SpanGeneratorResult {
  const chainTypes = ['SequentialChain', 'LLMChain', 'ConversationChain', 'MapReduceChain'];
  const chainType = randomElement(chainTypes);

  const input = {
    type: 'json',
    value: {
      input: randomElement(SAMPLE_USER_MESSAGES),
      chat_history: [],
    },
  };

  const output = {
    type: 'json',
    value: {
      output: randomElement(SAMPLE_ASSISTANT_RESPONSES),
    },
  };

  span.setAttributes({
    'langwatch.span.type': 'chain',
    'langwatch.input': JSON.stringify(input),
    'langwatch.output': JSON.stringify(output),
    'chain.type': chainType,
    'chain.verbose': true,
  });

  span.setStatus({ code: SpanStatusCode.OK });

  return { type: 'chain', name: spanName };
}

export function applyToolAttributes(span: Span, spanName: string): SpanGeneratorResult {
  const toolName = randomElement(TOOL_NAMES);

  const toolInputs: Record<string, object> = {
    search_web: { query: 'latest news about AI' },
    get_weather: { location: 'San Francisco, CA', units: 'celsius' },
    calculate: { expression: '(42 * 3) + 17' },
    send_email: { to: 'user@example.com', subject: 'Test', body: 'Hello!' },
    query_database: { sql: 'SELECT * FROM users LIMIT 10' },
    fetch_url: { url: 'https://api.example.com/data' },
    generate_image: { prompt: 'A sunset over mountains' },
    translate_text: { text: 'Hello world', target_language: 'es' },
  };

  const toolOutputs: Record<string, object> = {
    search_web: { results: [{ title: 'AI News', url: 'https://example.com', snippet: 'Latest AI developments...' }] },
    get_weather: { temperature: 18, condition: 'partly cloudy', humidity: 65 },
    calculate: { result: 143 },
    send_email: { status: 'sent', message_id: 'msg_123' },
    query_database: { rows: [{ id: 1, name: 'John' }], count: 1 },
    fetch_url: { status: 200, data: { key: 'value' } },
    generate_image: { image_url: 'https://example.com/image.png' },
    translate_text: { translated: 'Hola mundo' },
  };

  const input = {
    type: 'json',
    value: toolInputs[toolName] ?? { args: {} },
  };

  const output = {
    type: 'json',
    value: toolOutputs[toolName] ?? { result: 'success' },
  };

  span.setAttributes({
    'langwatch.span.type': 'tool',
    'langwatch.input': JSON.stringify(input),
    'langwatch.output': JSON.stringify(output),
    'tool.name': toolName,
    'tool.description': `Execute ${toolName} operation`,
  });

  span.setStatus({ code: SpanStatusCode.OK });

  return { type: 'tool', name: spanName };
}

export function applyRAGAttributes(span: Span, spanName: string): SpanGeneratorResult {
  const documents = [
    'The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.',
    'Machine learning is a subset of artificial intelligence that enables systems to learn from data.',
    'The Eiffel Tower was completed in 1889 and stands 324 meters tall in Paris, France.',
    'Python is a high-level programming language known for its readability and versatility.',
    'Climate change refers to long-term shifts in temperatures and weather patterns.',
  ];

  const contexts = Array.from({ length: randomInt(2, 5) }, (_, i) => ({
    document_id: `doc_${Date.now()}_${i}`,
    content: randomElement(documents),
    score: Math.random() * 0.3 + 0.7,
  }));

  const input = {
    type: 'text',
    value: randomElement(SAMPLE_USER_MESSAGES),
  };

  const output = {
    type: 'text',
    value: randomElement(SAMPLE_ASSISTANT_RESPONSES),
  };

  span.setAttributes({
    'langwatch.span.type': 'rag',
    'langwatch.input': JSON.stringify(input),
    'langwatch.output': JSON.stringify(output),
    'langwatch.contexts': JSON.stringify(contexts),
    'rag.retriever': 'vector_store',
    'rag.top_k': contexts.length,
  });

  span.setStatus({ code: SpanStatusCode.OK });

  return { type: 'rag', name: spanName };
}

export function applyAgentAttributes(span: Span, spanName: string): SpanGeneratorResult {
  const agentTypes = ['ReAct', 'OpenAI Functions', 'Plan-and-Execute', 'AutoGPT'];
  const agentType = randomElement(agentTypes);

  const input = {
    type: 'text',
    value: randomElement(SAMPLE_USER_MESSAGES),
  };

  const output = {
    type: 'json',
    value: {
      response: randomElement(SAMPLE_ASSISTANT_RESPONSES),
      steps_taken: randomInt(1, 5),
      tools_used: Array.from({ length: randomInt(1, 3) }, () => randomElement(TOOL_NAMES)),
    },
  };

  span.setAttributes({
    'langwatch.span.type': 'agent',
    'langwatch.input': JSON.stringify(input),
    'langwatch.output': JSON.stringify(output),
    'agent.type': agentType,
    'agent.max_iterations': randomInt(5, 20),
  });

  span.setStatus({ code: SpanStatusCode.OK });

  return { type: 'agent', name: spanName };
}

export type SpanGenerator = (span: Span, spanName: string) => SpanGeneratorResult;

export const SPAN_GENERATORS: Record<SpanType, SpanGenerator> = {
  llm: applyLLMAttributes,
  chain: applyChainAttributes,
  tool: applyToolAttributes,
  rag: applyRAGAttributes,
  agent: applyAgentAttributes,
};

export function getRandomSpanGenerator(): { type: SpanType; generator: SpanGenerator } {
  const weights: Record<SpanType, number> = {
    llm: 50,
    chain: 15,
    tool: 20,
    rag: 10,
    agent: 5,
  };

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;

  for (const [type, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      return { type: type as SpanType, generator: SPAN_GENERATORS[type as SpanType] };
    }
  }

  return { type: 'llm', generator: SPAN_GENERATORS.llm };
}
