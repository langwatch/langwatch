# Vercel AI SDK with LangWatch Observability

This example demonstrates how to use the Vercel AI SDK with LangWatch observability, supporting both LangWatch's native instrumentation and Vercel's OTEL instrumentation.

## Features

- 🤖 Interactive AI chatbot using Vercel AI SDK
- 📊 LangWatch observability integration
- ✨ **Native AI SDK instrumentation** for automatic span enrichment
- 🔄 Support for both LangWatch and Vercel OTEL instrumentation
- 🎨 Markdown formatting for AI responses
- 🧵 Thread-based conversation tracking

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your environment variables:
```bash
cp .env.example .env
# Edit .env with your OpenAI API key
```

## Usage

### LangWatch Instrumentation (Default)

Run with LangWatch's native observability setup:

```bash
npm run start:langwatch
```

Or directly with ts-node:

```bash
npx ts-node --require ./src/instrumentation.ts src/index.ts
```

### Vercel OTEL Instrumentation

Run with Vercel's OTEL instrumentation:

```bash
npm run start:vercel
```

Or directly with ts-node:

```bash
VERCEL=1 npx ts-node --require ./src/instrumentation.ts src/index.ts
```

## How It Works

The unified instrumentation file (`src/instrumentation.ts`) automatically detects the environment:

- **LangWatch Mode**: Uses `setupObservability()` from LangWatch
- **Vercel Mode**: Uses `registerOTel()` with LangWatch's trace exporter

The application automatically switches based on the `VERCEL` environment variable.

## Conversation Flow

1. Start the chatbot
2. Type your questions or requests
3. The AI responds with markdown-formatted text
4. Type "quit" or "exit" to end the conversation

## Observability Features

- **Native AI SDK Instrumentation**: LangWatch automatically enriches Vercel AI SDK spans with proper metadata
  - Spans from `ai.streamText`, `ai.generateText`, `ai.toolCall`, etc. are automatically categorized
  - Tool calls, embeddings, and LLM operations are properly typed for dashboard visualization
  - No manual span creation needed - just enable `experimental_telemetry` in AI SDK
- **Thread Tracking**: Each conversation session gets a unique thread ID
- **Span Creation**: Each iteration creates a new span for tracing
- **Error Handling**: Errors are captured and logged
- **Telemetry**: Vercel AI SDK telemetry is enabled

## Files Structure

```
src/
├── index.ts                    # Main application logic
├── instrumentation.ts          # Unified instrumentation setup
├── instrumentation-langwatch.ts # LangWatch-only instrumentation
└── instrumentation-vercel.ts   # Vercel OTEL instrumentation
```

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key
- `VERCEL`: Set to "1" to enable Vercel OTEL mode
- `LANGWATCH_API_KEY`: Your LangWatch API key (optional)

## AI SDK Instrumentation

LangWatch now provides native instrumentation for the Vercel AI SDK. When you enable `experimental_telemetry` in AI SDK calls, LangWatch automatically:

1. **Detects AI SDK spans** by their `ai.*` prefix
2. **Enriches spans** with `langwatch.span.type` for proper categorization:
   - `ai.streamText`, `ai.generateText` → `llm` type
   - `ai.toolCall` → `tool` type
   - `ai.embed`, `ai.embedMany` → `component` type
3. **Preserves all AI SDK attributes** like model info, usage metrics, and metadata

### Example with Native Instrumentation

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const result = streamText({
  model: openai('gpt-4'),
  prompt: 'What is 5 + 3? Use the calculator tool.',
  tools: {
    calculator: {
      description: 'Performs arithmetic',
      parameters: z.object({ operation: z.enum(['add', 'subtract']), a: z.number(), b: z.number() }),
      execute: async ({ operation, a, b }) => {
        return { result: operation === 'add' ? a + b : a - b };
      }
    }
  },
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-ai-function',
    metadata: {
      'langwatch.metadata.thread_id': 'thread-123',
      'custom.key': 'value'
    }
  }
});
```

LangWatch will automatically capture:
- The main `ai.streamText` span as type `llm`
- Any `ai.toolCall` spans as type `tool`
- Model usage, tokens, and all AI SDK metadata

### Configuration

Enable AI SDK instrumentation in your `setupObservability` call:

```typescript
setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
    enableAISDK: true, // Enable native AI SDK instrumentation (default: false)
  }
});
```

## Troubleshooting

- **TypeScript errors**: Run `npm run build` to check for compilation errors
- **Missing dependencies**: Run `npm install` to install all dependencies
- **Environment issues**: Ensure your `.env` file is properly configured
- **Spans not appearing**: Ensure `experimental_telemetry.isEnabled: true` is set in AI SDK calls
- **Spans missing metadata**: Verify `enableAISDK: true` is set in `setupObservability` configuration
