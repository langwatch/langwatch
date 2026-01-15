export type TestMode = 'realistic' | 'heavy' | 'scale';

export type SpanType = 'llm' | 'chain' | 'tool' | 'rag' | 'agent';

export interface ModeConfig {
  defaultTraces: number;
  defaultSpansPerTrace: number;
  minDelay: number;
  maxDelay: number;
  description: string;
}

export const MODE_CONFIGS: Record<TestMode, ModeConfig> = {
  realistic: {
    defaultTraces: 20,
    defaultSpansPerTrace: 5,
    minDelay: 100,
    maxDelay: 500,
    description: 'Normal traffic patterns with realistic delays',
  },
  heavy: {
    defaultTraces: 200,
    defaultSpansPerTrace: 20,
    minDelay: 10,
    maxDelay: 50,
    description: 'Heavy load testing with high throughput',
  },
  scale: {
    defaultTraces: 1000,
    defaultSpansPerTrace: 50,
    minDelay: 0,
    maxDelay: 10,
    description: 'Extreme scale testing for max throughput',
  },
};

export interface StressTestConfig {
  mode: TestMode;
  totalTraces: number;
  maxDepth: number;
  avgSpansPerTrace: number;
  duration: number;
  reportPath: string | null;
}

export interface SpanRecord {
  spanId: string;
  name: string;
  type: SpanType;
}

export interface TraceRecord {
  traceId: string;
  spans: SpanRecord[];
}

export interface StressTestStats {
  requestsSent: number;
  tracesSent: number;
  spansSent: number;
  errors: number;
  startTime: number;
  endTime: number;
}

export interface StressTestReport {
  runId: string;
  timestamp: string;
  mode: TestMode;
  config: {
    totalTraces: number;
    avgSpansPerTrace: number;
    maxDepth: number;
  };
  stats: {
    duration: number;
    tracesSent: number;
    spansSent: number;
    errors: number;
    throughput: number;
  };
  traces: TraceRecord[];
}

export interface VerificationResult {
  tracesChecked: number;
  tracesFound: number;
  tracesMissing: number;
  spansChecked: number;
  spansFound: number;
  spansMissing: number;
  missingTraces: string[];
  missingSpans: Array<{ traceId: string; spanId: string }>;
}

export interface LLMVendor {
  name: string;
  models: string[];
}

export const VENDORS: LLMVendor[] = [
  { name: 'openai', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { name: 'anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] },
  { name: 'google', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'] },
  { name: 'azure', models: ['gpt-4o', 'gpt-4-turbo'] },
];

export const SAMPLE_SYSTEM_PROMPTS = [
  'You are a helpful assistant that answers questions concisely and accurately.',
  'You are an expert software engineer. Help users debug their code and explain concepts clearly.',
  'You are a creative writing assistant. Help users craft engaging stories and content.',
  'You are a data analyst assistant. Help users understand and analyze their data.',
  'You are a customer support agent. Be polite, helpful, and resolve issues efficiently.',
];

export const SAMPLE_USER_MESSAGES = [
  'What is the capital of France?',
  'Can you help me debug this Python code?',
  'Write a short story about a robot learning to paint.',
  'How do I optimize this SQL query for better performance?',
  'What are the best practices for building REST APIs?',
  'Explain the concept of recursion with an example.',
  'Help me analyze this sales data.',
  'What is the difference between let and const in JavaScript?',
  'How do I implement authentication in a web application?',
  'Can you explain machine learning in simple terms?',
];

export const SAMPLE_ASSISTANT_RESPONSES = [
  'The capital of France is Paris.',
  'I can help you debug that. Let me analyze the code...',
  'Here is a short story about a robot named Canvas...',
  'To optimize your SQL query, consider adding an index...',
  'Here are the best practices for REST APIs: 1. Use proper HTTP methods...',
  'Recursion is when a function calls itself. Here is an example...',
  'Based on the sales data, I can see several trends...',
  'The main difference is that const creates a constant reference...',
  'For authentication, I recommend using JWT tokens...',
  'Machine learning is a type of AI that learns from data...',
];

export const TOOL_NAMES = [
  'search_web',
  'get_weather',
  'calculate',
  'send_email',
  'query_database',
  'fetch_url',
  'generate_image',
  'translate_text',
];
