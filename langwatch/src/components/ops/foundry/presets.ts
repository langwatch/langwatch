import type { Preset, SpanConfig } from "./types";

function span(
  overrides: Partial<SpanConfig> & { name: string; type: SpanConfig["type"] }
): SpanConfig {
  return {
    id: crypto.randomUUID().slice(0, 10),
    durationMs: 100,
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    ...overrides,
  };
}

export const builtInPresets: Preset[] = [
  {
    id: "simple-llm-call",
    name: "Simple LLM Call",
    description: "A single LLM span with user message and assistant response",
    builtIn: true,
    config: {
      id: "simple-llm-call",
      name: "Simple LLM Call",
      resourceAttributes: { "service.name": "chatbot" },
      metadata: { userId: "user-123" },
      spans: [
        span({
          name: "chat-completion",
          type: "llm",
          durationMs: 450,
          llm: {
            requestModel: "gpt-4o",
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "What is OpenTelemetry?" },
              {
                role: "assistant",
                content:
                  "OpenTelemetry is an open-source observability framework for generating, collecting, and exporting telemetry data such as traces, metrics, and logs.",
              },
            ],
            temperature: 0.7,
            metrics: { promptTokens: 28, completionTokens: 35, cost: 0.0019 },
          },
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "What is OpenTelemetry?" },
            ],
          },
          output: {
            type: "text",
            value:
              "OpenTelemetry is an open-source observability framework for generating, collecting, and exporting telemetry data such as traces, metrics, and logs.",
          },
        }),
      ],
    },
  },
  {
    id: "rag-pipeline",
    name: "RAG Pipeline",
    description:
      "Retrieval-Augmented Generation: retrieve documents then generate with context",
    builtIn: true,
    config: {
      id: "rag-pipeline",
      name: "RAG Pipeline",
      resourceAttributes: { "service.name": "knowledge-bot" },
      metadata: { userId: "user-456", threadId: "thread-1" },
      spans: [
        span({
          name: "rag-pipeline",
          type: "chain",
          durationMs: 1200,
          children: [
            span({
              name: "document-retrieval",
              type: "rag",
              durationMs: 300,
              rag: {
                contexts: [
                  {
                    document_id: "doc-opentelemetry-guide",
                    chunk_id: "chunk-3",
                    content:
                      "OpenTelemetry provides a single set of APIs, libraries, agents, and instrumentation to capture distributed traces and metrics.",
                  },
                  {
                    document_id: "doc-observability-101",
                    chunk_id: "chunk-7",
                    content:
                      "The three pillars of observability are traces, metrics, and logs. Together they provide comprehensive system visibility.",
                  },
                ],
              },
              input: { type: "text", value: "What is OpenTelemetry?" },
              output: {
                type: "json",
                value: { documentsRetrieved: 2, topScore: 0.94 },
              },
            }),
            span({
              name: "generate-response",
              type: "llm",
              durationMs: 800,
              offsetMs: 350,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content:
                      "Answer using the provided context. Context: OpenTelemetry provides a single set of APIs...",
                  },
                  { role: "user", content: "What is OpenTelemetry?" },
                  {
                    role: "assistant",
                    content:
                      "Based on the documentation, OpenTelemetry is a unified observability framework that provides APIs and tools for capturing traces and metrics.",
                  },
                ],
                temperature: 0.3,
                metrics: {
                  promptTokens: 120,
                  completionTokens: 45,
                  cost: 0.0063,
                },
              },
              input: { type: "text", value: "What is OpenTelemetry?" },
              output: {
                type: "text",
                value:
                  "Based on the documentation, OpenTelemetry is a unified observability framework that provides APIs and tools for capturing traces and metrics.",
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "agent-with-tools",
    name: "Agent with Tools",
    description: "An agent that uses multiple tools before responding",
    builtIn: true,
    config: {
      id: "agent-with-tools",
      name: "Agent with Tools",
      resourceAttributes: { "service.name": "research-agent" },
      metadata: { userId: "user-789" },
      spans: [
        span({
          name: "research-agent",
          type: "agent",
          durationMs: 3500,
          input: {
            type: "text",
            value: "What's the weather in Tokyo and convert 100 USD to JPY?",
          },
          output: {
            type: "text",
            value:
              "The weather in Tokyo is 22°C and sunny. 100 USD equals approximately 15,300 JPY.",
          },
          children: [
            span({
              name: "plan",
              type: "llm",
              durationMs: 400,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  {
                    role: "user",
                    content:
                      "What's the weather in Tokyo and convert 100 USD to JPY?",
                  },
                  {
                    role: "assistant",
                    content:
                      'I need to use two tools: weather_lookup and currency_convert.',
                  },
                ],
                metrics: { promptTokens: 45, completionTokens: 30 },
              },
            }),
            span({
              name: "weather_lookup",
              type: "tool",
              durationMs: 800,
              offsetMs: 450,
              input: { type: "json", value: { city: "Tokyo" } },
              output: {
                type: "json",
                value: { temp: 22, condition: "sunny", humidity: 45 },
              },
            }),
            span({
              name: "currency_convert",
              type: "tool",
              durationMs: 600,
              offsetMs: 500,
              input: {
                type: "json",
                value: { from: "USD", to: "JPY", amount: 100 },
              },
              output: {
                type: "json",
                value: { result: 15300, rate: 153.0 },
              },
            }),
            span({
              name: "synthesize",
              type: "llm",
              durationMs: 500,
              offsetMs: 2800,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  {
                    role: "assistant",
                    content:
                      "The weather in Tokyo is 22°C and sunny. 100 USD equals approximately 15,300 JPY.",
                  },
                ],
                metrics: { promptTokens: 80, completionTokens: 35 },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "multi-turn-conversation",
    name: "Multi-turn Conversation",
    description: "A chain of sequential LLM calls simulating a conversation",
    builtIn: true,
    config: {
      id: "multi-turn-conversation",
      name: "Multi-turn Conversation",
      resourceAttributes: { "service.name": "chat-app" },
      metadata: { userId: "user-100", threadId: "conv-42" },
      spans: [
        span({
          name: "conversation",
          type: "chain",
          durationMs: 2000,
          children: [
            span({
              name: "turn-1",
              type: "llm",
              durationMs: 500,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  { role: "user", content: "Hi! What can you help me with?" },
                  {
                    role: "assistant",
                    content:
                      "Hello! I can help with coding, writing, analysis, and more. What would you like to work on?",
                  },
                ],
                metrics: { promptTokens: 15, completionTokens: 25 },
              },
            }),
            span({
              name: "turn-2",
              type: "llm",
              durationMs: 600,
              offsetMs: 700,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: "Can you explain what a monad is?",
                  },
                  {
                    role: "assistant",
                    content:
                      "A monad is a design pattern in functional programming that wraps values in a context and provides a way to chain operations on those wrapped values.",
                  },
                ],
                metrics: { promptTokens: 40, completionTokens: 45 },
              },
            }),
            span({
              name: "turn-3",
              type: "llm",
              durationMs: 500,
              offsetMs: 1400,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: "Can you give me an example in TypeScript?",
                  },
                  {
                    role: "assistant",
                    content:
                      "Sure! Think of Promise<T> — it wraps a value T, and .then() lets you chain operations: fetchUser().then(user => fetchPosts(user.id)).",
                  },
                ],
                metrics: { promptTokens: 90, completionTokens: 50 },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "guardrail-pipeline",
    name: "Guardrail Pipeline",
    description: "LLM output checked by a guardrail before returning",
    builtIn: true,
    config: {
      id: "guardrail-pipeline",
      name: "Guardrail Pipeline",
      resourceAttributes: { "service.name": "safe-chat" },
      metadata: {},
      spans: [
        span({
          name: "safe-pipeline",
          type: "chain",
          durationMs: 1000,
          children: [
            span({
              name: "generate",
              type: "llm",
              durationMs: 500,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "user", content: "Tell me about safety protocols" },
                  {
                    role: "assistant",
                    content:
                      "Safety protocols are essential procedures designed to protect people and systems from harm.",
                  },
                ],
                metrics: { promptTokens: 20, completionTokens: 25 },
              },
            }),
            span({
              name: "content-safety-check",
              type: "guardrail",
              durationMs: 200,
              offsetMs: 550,
              input: {
                type: "text",
                value:
                  "Safety protocols are essential procedures designed to protect people and systems from harm.",
              },
              output: {
                type: "json",
                value: { passed: true, score: 0.98, category: "safe" },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "error-trace",
    name: "Error Trace",
    description: "A pipeline where a tool call fails with an exception",
    builtIn: true,
    config: {
      id: "error-trace",
      name: "Error Trace",
      resourceAttributes: { "service.name": "flaky-service" },
      metadata: { labels: ["debug", "error-testing"] },
      spans: [
        span({
          name: "process-request",
          type: "chain",
          durationMs: 800,
          status: "error",
          children: [
            span({
              name: "validate-input",
              type: "span",
              durationMs: 50,
              input: { type: "json", value: { query: "test" } },
            }),
            span({
              name: "fetch-data",
              type: "tool",
              durationMs: 500,
              offsetMs: 100,
              status: "error",
              exception: {
                message: "Connection timeout: database not responding",
                stackTrace:
                  "Error: Connection timeout\n  at DatabaseClient.query (db.ts:42)\n  at fetchData (handler.ts:15)\n  at processRequest (pipeline.ts:28)",
              },
              input: {
                type: "json",
                value: { query: "SELECT * FROM users" },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "complex-workflow",
    name: "Complex Nested Workflow",
    description: "A deeply nested workflow with agents, tools, and LLM calls",
    builtIn: true,
    config: {
      id: "complex-workflow",
      name: "Complex Nested Workflow",
      resourceAttributes: {
        "service.name": "orchestrator",
        "service.version": "2.1.0",
      },
      metadata: { userId: "user-admin", customerId: "org-acme" },
      spans: [
        span({
          name: "orchestrate",
          type: "workflow",
          durationMs: 5000,
          children: [
            span({
              name: "classify-intent",
              type: "llm",
              durationMs: 300,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: "Analyze last quarter's sales data",
                  },
                  {
                    role: "assistant",
                    content: '{"intent": "data_analysis", "confidence": 0.95}',
                  },
                ],
                metrics: { promptTokens: 20, completionTokens: 15 },
              },
            }),
            span({
              name: "data-analysis-agent",
              type: "agent",
              durationMs: 4200,
              offsetMs: 400,
              children: [
                span({
                  name: "query-database",
                  type: "tool",
                  durationMs: 800,
                  input: {
                    type: "json",
                    value: {
                      query: "SELECT * FROM sales WHERE quarter = 'Q4'",
                    },
                  },
                  output: {
                    type: "json",
                    value: { rowCount: 1250, totalRevenue: 4500000 },
                  },
                }),
                span({
                  name: "analyze",
                  type: "llm",
                  durationMs: 1200,
                  offsetMs: 900,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      {
                        role: "user",
                        content:
                          "Analyze this sales data: 1250 transactions, $4.5M revenue...",
                      },
                      {
                        role: "assistant",
                        content:
                          "Q4 showed strong performance with $4.5M in revenue across 1,250 transactions. Average deal size was $3,600.",
                      },
                    ],
                    temperature: 0.2,
                    metrics: {
                      promptTokens: 200,
                      completionTokens: 150,
                      cost: 0.015,
                    },
                  },
                }),
                span({
                  name: "generate-chart",
                  type: "tool",
                  durationMs: 400,
                  offsetMs: 2200,
                  input: {
                    type: "json",
                    value: { type: "bar", data: "quarterly_revenue" },
                  },
                  output: {
                    type: "json",
                    value: { chartUrl: "https://charts.example.com/q4" },
                  },
                }),
                span({
                  name: "compose-report",
                  type: "llm",
                  durationMs: 800,
                  offsetMs: 2700,
                  llm: {
                    requestModel: "gpt-4o",
                    metrics: {
                      promptTokens: 300,
                      completionTokens: 200,
                      cost: 0.02,
                    },
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "prompt-template",
    name: "Prompt Template Usage",
    description: "A prompt span linked to a prompt ID feeding into an LLM call",
    builtIn: true,
    config: {
      id: "prompt-template",
      name: "Prompt Template Usage",
      resourceAttributes: { "service.name": "prompt-service" },
      metadata: {},
      spans: [
        span({
          name: "render-and-call",
          type: "chain",
          durationMs: 700,
          children: [
            span({
              name: "render-prompt",
              type: "prompt",
              durationMs: 50,
              prompt: {
                promptId: "customer-support-v2",
                versionId: "ver-abc123",
                variables: {
                  customer_name: "Alice",
                  issue: "billing discrepancy",
                },
              },
              input: {
                type: "json",
                value: {
                  template:
                    "Help {{customer_name}} with their {{issue}} issue.",
                },
              },
              output: {
                type: "text",
                value:
                  "Help Alice with their billing discrepancy issue.",
              },
            }),
            span({
              name: "llm-call",
              type: "llm",
              durationMs: 600,
              offsetMs: 80,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  {
                    role: "system",
                    content:
                      "Help Alice with their billing discrepancy issue.",
                  },
                  {
                    role: "user",
                    content:
                      "I was charged twice for my subscription last month.",
                  },
                  {
                    role: "assistant",
                    content:
                      "I understand your concern, Alice. Let me look into the duplicate charge on your subscription.",
                  },
                ],
                metrics: { promptTokens: 50, completionTokens: 30 },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "parallel-tool-calls",
    name: "Parallel Tool Calls",
    description: "An agent running three tool calls concurrently",
    builtIn: true,
    config: {
      id: "parallel-tool-calls",
      name: "Parallel Tool Calls",
      resourceAttributes: { "service.name": "parallel-agent" },
      metadata: {},
      spans: [
        span({
          name: "multi-search",
          type: "agent",
          durationMs: 2000,
          children: [
            span({
              name: "search-web",
              type: "tool",
              durationMs: 800,
              offsetMs: 200,
              input: { type: "json", value: { query: "latest AI news" } },
              output: {
                type: "json",
                value: { results: 10, topResult: "AI breakthrough in..." },
              },
            }),
            span({
              name: "search-docs",
              type: "tool",
              durationMs: 600,
              offsetMs: 200,
              input: {
                type: "json",
                value: { query: "AI news", source: "internal-docs" },
              },
              output: {
                type: "json",
                value: { results: 3, topResult: "Internal AI update..." },
              },
            }),
            span({
              name: "search-database",
              type: "tool",
              durationMs: 400,
              offsetMs: 200,
              input: {
                type: "json",
                value: { query: "SELECT * FROM articles WHERE topic='AI'" },
              },
              output: {
                type: "json",
                value: { results: 25, cached: true },
              },
            }),
            span({
              name: "merge-results",
              type: "llm",
              durationMs: 500,
              offsetMs: 1100,
              llm: {
                requestModel: "gpt-4o-mini",
                metrics: { promptTokens: 150, completionTokens: 80 },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "streaming-llm",
    name: "Streaming LLM with TTFT",
    description: "An LLM span with first_token_at timing for streaming metrics",
    builtIn: true,
    config: {
      id: "streaming-llm",
      name: "Streaming LLM with TTFT",
      resourceAttributes: { "service.name": "stream-service" },
      metadata: {},
      spans: [
        span({
          name: "streaming-completion",
          type: "llm",
          durationMs: 2000,
          llm: {
            requestModel: "gpt-4o",
            stream: true,
            messages: [
              {
                role: "user",
                content:
                  "Write a short poem about distributed systems.",
              },
              {
                role: "assistant",
                content:
                  "Across the wires, data flows,\nThrough nodes and shards, the system grows.\nConsensus reached through Raft or Paxos bright,\nDistributed dreams take flight tonight.",
              },
            ],
            temperature: 0.9,
            metrics: {
              promptTokens: 15,
              completionTokens: 40,
              cost: 0.003,
            },
          },
          attributes: {
            "langwatch.gen_ai.streaming": true,
          },
          input: {
            type: "text",
            value: "Write a short poem about distributed systems.",
          },
          output: {
            type: "text",
            value:
              "Across the wires, data flows,\nThrough nodes and shards, the system grows.\nConsensus reached through Raft or Paxos bright,\nDistributed dreams take flight tonight.",
          },
        }),
      ],
    },
  },

  // === SDK-specific presets ===

  {
    id: "vercel-ai-sdk",
    name: "Vercel AI SDK",
    description:
      "Typical trace from Vercel AI SDK with generateText and tool calls using ai.* span naming",
    builtIn: true,
    config: {
      id: "vercel-ai-sdk",
      name: "Vercel AI SDK",
      resourceAttributes: { "service.name": "next-app" },
      metadata: { userId: "user-vercel-1" },
      spans: [
        span({
          name: "ai.generateText",
          type: "chain",
          durationMs: 1800,
          attributes: {
            "ai.model.id": "gpt-4o",
            "ai.model.provider": "openai",
            "ai.operationId": "ai.generateText",
            "ai.settings.maxRetries": 2,
          },
          input: { type: "text", value: "Search for the latest news on AI regulation" },
          output: { type: "text", value: "According to recent reports, the EU AI Act..." },
          children: [
            span({
              name: "ai.generateText.doGenerate",
              type: "llm",
              durationMs: 900,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "system", content: "You are a helpful research assistant." },
                  { role: "user", content: "Search for the latest news on AI regulation" },
                  { role: "assistant", content: "I'll search for that information using the web_search tool." },
                ],
                temperature: 0.7,
                metrics: { promptTokens: 85, completionTokens: 40 },
              },
              attributes: {
                "ai.model.id": "gpt-4o",
                "ai.model.provider": "openai",
                "ai.finishReason": "tool-calls",
                "gen_ai.system": "openai",
              },
            }),
            span({
              name: "ai.toolCall web_search",
              type: "tool",
              durationMs: 400,
              offsetMs: 950,
              input: { type: "json", value: { query: "AI regulation 2025 latest news" } },
              output: { type: "json", value: { results: [{ title: "EU AI Act Update", snippet: "New provisions..." }] } },
              attributes: {
                "ai.toolCall.name": "web_search",
                "ai.toolCall.id": "call_abc123",
              },
            }),
            span({
              name: "ai.generateText.doGenerate",
              type: "llm",
              durationMs: 600,
              offsetMs: 1400,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "assistant", content: "According to recent reports, the EU AI Act has entered its enforcement phase..." },
                ],
                metrics: { promptTokens: 200, completionTokens: 120 },
              },
              attributes: {
                "ai.model.id": "gpt-4o",
                "ai.model.provider": "openai",
                "ai.finishReason": "stop",
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "mastra-agent",
    name: "Mastra Agent",
    description: "A Mastra framework agent trace with workflow steps and tool execution",
    builtIn: true,
    config: {
      id: "mastra-agent",
      name: "Mastra Agent",
      resourceAttributes: { "service.name": "mastra-app" },
      metadata: { userId: "user-mastra-1", labels: ["mastra"] },
      spans: [
        span({
          name: "mastra.agent.run",
          type: "agent",
          durationMs: 4000,
          attributes: {
            "mastra.agent.name": "research-assistant",
            "mastra.agent.model": "gpt-4o",
          },
          input: { type: "text", value: "Summarize the top 3 trending repos on GitHub today" },
          output: { type: "text", value: "Here are today's top trending repos: 1. langwatch/langwatch..." },
          children: [
            span({
              name: "mastra.agent.generate",
              type: "llm",
              durationMs: 800,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "system", content: "You are a research assistant with access to GitHub tools." },
                  { role: "user", content: "Summarize the top 3 trending repos on GitHub today" },
                  { role: "assistant", content: "I'll use the github_trending tool to find today's trending repositories." },
                ],
                metrics: { promptTokens: 60, completionTokens: 35 },
              },
              attributes: { "mastra.step": "plan" },
            }),
            span({
              name: "mastra.tool.execute github_trending",
              type: "tool",
              durationMs: 1200,
              offsetMs: 850,
              input: { type: "json", value: { language: "all", since: "daily", limit: 3 } },
              output: {
                type: "json",
                value: [
                  { name: "langwatch/langwatch", stars: 5200, description: "LLM Ops platform" },
                  { name: "vercel/ai", stars: 12000, description: "AI SDK" },
                  { name: "anthropics/claude-code", stars: 18000, description: "CLI for Claude" },
                ],
              },
              attributes: { "mastra.tool.name": "github_trending" },
            }),
            span({
              name: "mastra.agent.generate",
              type: "llm",
              durationMs: 1000,
              offsetMs: 2200,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "assistant", content: "Here are today's top trending repos:\n1. langwatch/langwatch (5.2k stars)..." },
                ],
                metrics: { promptTokens: 250, completionTokens: 150, cost: 0.02 },
              },
              attributes: { "mastra.step": "synthesize" },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "langchain-rag",
    name: "LangChain RAG",
    description: "LangChain-style RAG chain with retriever and LLM using langchain callback spans",
    builtIn: true,
    config: {
      id: "langchain-rag",
      name: "LangChain RAG",
      resourceAttributes: { "service.name": "langchain-app" },
      metadata: { threadId: "lc-thread-42" },
      spans: [
        span({
          name: "RunnableSequence",
          type: "chain",
          durationMs: 2500,
          attributes: {
            "langwatch.langchain.run.type": "chain",
            "langwatch.langchain.tags": "rag-pipeline",
          },
          children: [
            span({
              name: "VectorStoreRetriever",
              type: "rag",
              durationMs: 600,
              attributes: {
                "langwatch.langchain.run.type": "retriever",
              },
              rag: {
                contexts: [
                  { document_id: "pg-essay-1", chunk_id: "chunk-12", content: "The best way to get startup ideas is not to try to think of startup ideas..." },
                  { document_id: "pg-essay-1", chunk_id: "chunk-13", content: "Live in the future, then build what's missing." },
                  { document_id: "pg-essay-2", chunk_id: "chunk-5", content: "Do things that don't scale. The most common unscalable thing founders have to do..." },
                ],
              },
              input: { type: "text", value: "What does Paul Graham say about startup ideas?" },
              output: { type: "json", value: { documents: 3 } },
            }),
            span({
              name: "PromptTemplate",
              type: "prompt",
              durationMs: 20,
              offsetMs: 650,
              attributes: {
                "langwatch.langchain.run.type": "prompt",
              },
              input: {
                type: "json",
                value: { context: "{retrieved_docs}", question: "{user_question}" },
              },
              output: {
                type: "text",
                value: "Based on the following context, answer the question.\n\nContext: The best way to get startup ideas...\n\nQuestion: What does Paul Graham say about startup ideas?",
              },
            }),
            span({
              name: "ChatOpenAI",
              type: "llm",
              durationMs: 1200,
              offsetMs: 700,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "system", content: "Based on the following context, answer the question.\n\nContext: The best way to get startup ideas..." },
                  { role: "user", content: "What does Paul Graham say about startup ideas?" },
                  { role: "assistant", content: "Paul Graham advises against deliberately brainstorming startup ideas. Instead, he recommends living in the future and building what's missing. He also emphasizes doing things that don't scale in the early stages." },
                ],
                temperature: 0,
                metrics: { promptTokens: 180, completionTokens: 60, cost: 0.009 },
              },
              attributes: {
                "langwatch.langchain.run.type": "llm",
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "agno-agent",
    name: "Agno Agent",
    description: "An Agno (formerly Phidata) agent with knowledge base and tool use",
    builtIn: true,
    config: {
      id: "agno-agent",
      name: "Agno Agent",
      resourceAttributes: { "service.name": "agno-app" },
      metadata: { userId: "user-agno-1", labels: ["agno", "knowledge-agent"] },
      spans: [
        span({
          name: "agno.agent.run",
          type: "agent",
          durationMs: 3200,
          attributes: {
            "agno.agent.name": "finance-analyst",
            "agno.agent.model": "gpt-4o",
          },
          input: { type: "text", value: "What's the current P/E ratio of AAPL and how does it compare to the sector average?" },
          output: { type: "text", value: "Apple's current P/E ratio is 32.5, compared to the Technology sector average of 28.1..." },
          children: [
            span({
              name: "agno.knowledge.search",
              type: "rag",
              durationMs: 400,
              rag: {
                contexts: [
                  { document_id: "market-data-2025", chunk_id: "aapl-fundamentals", content: "AAPL: P/E 32.5, Forward P/E 29.8, PEG 1.85" },
                  { document_id: "sector-analysis", chunk_id: "tech-sector-avg", content: "Technology sector avg P/E: 28.1, median: 25.3" },
                ],
              },
              input: { type: "text", value: "AAPL P/E ratio sector comparison" },
            }),
            span({
              name: "agno.tool.run get_stock_data",
              type: "tool",
              durationMs: 800,
              offsetMs: 450,
              input: { type: "json", value: { symbol: "AAPL", metrics: ["pe_ratio", "forward_pe", "peg_ratio"] } },
              output: { type: "json", value: { pe_ratio: 32.5, forward_pe: 29.8, peg_ratio: 1.85, price: 198.50 } },
              attributes: { "agno.tool.name": "get_stock_data" },
            }),
            span({
              name: "agno.agent.generate",
              type: "llm",
              durationMs: 1000,
              offsetMs: 1400,
              llm: {
                requestModel: "gpt-4o",
                messages: [
                  { role: "user", content: "What's the current P/E ratio of AAPL and how does it compare to the sector average?" },
                  { role: "assistant", content: "Apple's current P/E ratio is 32.5, compared to the Technology sector average of 28.1. This means Apple trades at a 15.7% premium to the sector." },
                ],
                temperature: 0.3,
                metrics: { promptTokens: 280, completionTokens: 90, cost: 0.014 },
              },
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "crewai-crew",
    name: "CrewAI Crew",
    description: "A CrewAI multi-agent crew with researcher and writer agents collaborating",
    builtIn: true,
    config: {
      id: "crewai-crew",
      name: "CrewAI Crew",
      resourceAttributes: { "service.name": "crewai-app" },
      metadata: { labels: ["crewai", "multi-agent"] },
      spans: [
        span({
          name: "crew.kickoff",
          type: "workflow",
          durationMs: 8000,
          attributes: {
            "crewai.crew.name": "content-creation-crew",
            "crewai.crew.agents": 2,
          },
          children: [
            span({
              name: "agent.researcher.execute_task",
              type: "agent",
              durationMs: 4500,
              attributes: {
                "crewai.agent.role": "Senior Researcher",
                "crewai.task.description": "Research the latest trends in AI agents",
              },
              children: [
                span({
                  name: "researcher.llm.generate",
                  type: "llm",
                  durationMs: 600,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      { role: "system", content: "You are a Senior Researcher. Research the latest trends in AI agents." },
                      { role: "assistant", content: "I need to search for recent developments. Let me use the search tool." },
                    ],
                    metrics: { promptTokens: 100, completionTokens: 30 },
                  },
                }),
                span({
                  name: "researcher.tool.web_search",
                  type: "tool",
                  durationMs: 1500,
                  offsetMs: 700,
                  input: { type: "json", value: { query: "AI agents trends 2025" } },
                  output: { type: "json", value: { results: 15, summary: "Multi-agent systems, tool use, and autonomous coding are top trends." } },
                }),
                span({
                  name: "researcher.llm.synthesize",
                  type: "llm",
                  durationMs: 1200,
                  offsetMs: 2300,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      { role: "assistant", content: "Key findings: 1) Multi-agent collaboration is replacing single-agent architectures. 2) Tool use is becoming standardized via MCP. 3) Autonomous coding agents are gaining enterprise adoption." },
                    ],
                    metrics: { promptTokens: 350, completionTokens: 200, cost: 0.025 },
                  },
                }),
              ],
            }),
            span({
              name: "agent.writer.execute_task",
              type: "agent",
              durationMs: 3000,
              offsetMs: 4800,
              attributes: {
                "crewai.agent.role": "Content Writer",
                "crewai.task.description": "Write a blog post based on the research",
              },
              children: [
                span({
                  name: "writer.llm.generate",
                  type: "llm",
                  durationMs: 2500,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      { role: "system", content: "You are a Content Writer. Write a compelling blog post based on the research provided." },
                      { role: "assistant", content: "# The Rise of AI Agents in 2025\n\nThe landscape of AI agents is evolving rapidly..." },
                    ],
                    temperature: 0.7,
                    metrics: { promptTokens: 400, completionTokens: 500, cost: 0.04 },
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "openai-agents-sdk",
    name: "OpenAI Agents SDK",
    description: "OpenAI Agents SDK trace with handoffs between specialized agents",
    builtIn: true,
    config: {
      id: "openai-agents-sdk",
      name: "OpenAI Agents SDK",
      resourceAttributes: { "service.name": "openai-agents-app" },
      metadata: { labels: ["openai", "agents-sdk"] },
      spans: [
        span({
          name: "agents.run",
          type: "workflow",
          durationMs: 5000,
          attributes: {
            "openai.agents.entry_agent": "triage-agent",
          },
          children: [
            span({
              name: "agent.triage-agent",
              type: "agent",
              durationMs: 1200,
              attributes: { "openai.agents.agent.name": "triage-agent" },
              children: [
                span({
                  name: "responses.create",
                  type: "llm",
                  durationMs: 800,
                  llm: {
                    requestModel: "gpt-4o-mini",
                    messages: [
                      { role: "system", content: "You are a triage agent. Route the user to the appropriate specialist." },
                      { role: "user", content: "I need help with a refund for my order" },
                      { role: "assistant", content: "I'll transfer you to our billing specialist who can help with refunds." },
                    ],
                    metrics: { promptTokens: 45, completionTokens: 25 },
                  },
                  attributes: { "openai.agents.handoff": "billing-agent" },
                }),
              ],
            }),
            span({
              name: "agent.billing-agent",
              type: "agent",
              durationMs: 3500,
              offsetMs: 1300,
              attributes: { "openai.agents.agent.name": "billing-agent" },
              children: [
                span({
                  name: "tool.lookup_order",
                  type: "tool",
                  durationMs: 500,
                  input: { type: "json", value: { customer_id: "cust_123", order_type: "recent" } },
                  output: { type: "json", value: { order_id: "ord_456", amount: 79.99, status: "delivered" } },
                }),
                span({
                  name: "responses.create",
                  type: "llm",
                  durationMs: 600,
                  offsetMs: 600,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      { role: "assistant", content: "I found your order #ord_456 for $79.99. I can process a refund. Would you like to proceed?" },
                    ],
                    metrics: { promptTokens: 150, completionTokens: 40 },
                  },
                }),
                span({
                  name: "tool.process_refund",
                  type: "tool",
                  durationMs: 800,
                  offsetMs: 1400,
                  input: { type: "json", value: { order_id: "ord_456", amount: 79.99, reason: "customer_request" } },
                  output: { type: "json", value: { refund_id: "ref_789", status: "processed", eta_days: 3 } },
                }),
                span({
                  name: "responses.create",
                  type: "llm",
                  durationMs: 500,
                  offsetMs: 2400,
                  llm: {
                    requestModel: "gpt-4o",
                    messages: [
                      { role: "assistant", content: "Your refund of $79.99 has been processed. You should see it in your account within 3 business days." },
                    ],
                    metrics: { promptTokens: 200, completionTokens: 35 },
                  },
                }),
              ],
            }),
          ],
        }),
      ],
    },
  },
  {
    id: "dspy-module",
    name: "DSPy Module",
    description: "DSPy-style trace with modules, predictions, and retrieval",
    builtIn: true,
    config: {
      id: "dspy-module",
      name: "DSPy Module",
      resourceAttributes: { "service.name": "dspy-app" },
      metadata: { labels: ["dspy"] },
      spans: [
        span({
          name: "SimplifiedBaleen",
          type: "module",
          durationMs: 3000,
          attributes: { "dspy.module": "SimplifiedBaleen" },
          children: [
            span({
              name: "ChainOfThought.generate_query[0]",
              type: "llm",
              durationMs: 600,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  { role: "user", content: "Write a search query to find: How many storeys are in the castle David Gregory inherited?" },
                  { role: "assistant", content: "David Gregory inherited castle number of storeys floors" },
                ],
                metrics: { promptTokens: 30, completionTokens: 12 },
              },
              attributes: { "dspy.predictor": "generate_query", "dspy.hop": 0 },
            }),
            span({
              name: "Retrieve[0]",
              type: "rag",
              durationMs: 300,
              offsetMs: 650,
              rag: {
                contexts: [
                  { document_id: "wiki-kinnettles", chunk_id: "p1", content: "Kinnettles is a five-storey castle. David Gregory inherited it from his father." },
                ],
              },
              attributes: { "dspy.retriever": "ColBERTv2", "dspy.hop": 0 },
            }),
            span({
              name: "ChainOfThought.generate_query[1]",
              type: "llm",
              durationMs: 500,
              offsetMs: 1000,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  { role: "assistant", content: "Kinnettles castle architecture storeys history" },
                ],
                metrics: { promptTokens: 60, completionTokens: 10 },
              },
              attributes: { "dspy.predictor": "generate_query", "dspy.hop": 1 },
            }),
            span({
              name: "Retrieve[1]",
              type: "rag",
              durationMs: 250,
              offsetMs: 1550,
              rag: {
                contexts: [
                  { document_id: "wiki-kinnettles-arch", chunk_id: "p2", content: "The castle was built in the 15th century and has five storeys with a garret." },
                ],
              },
              attributes: { "dspy.retriever": "ColBERTv2", "dspy.hop": 1 },
            }),
            span({
              name: "ChainOfThought.generate_answer",
              type: "llm",
              durationMs: 700,
              offsetMs: 1850,
              llm: {
                requestModel: "gpt-4o-mini",
                messages: [
                  { role: "assistant", content: "The castle that David Gregory inherited, Kinnettles, has five storeys." },
                ],
                metrics: { promptTokens: 120, completionTokens: 20 },
              },
              attributes: { "dspy.predictor": "generate_answer" },
            }),
          ],
        }),
      ],
    },
  },
];
