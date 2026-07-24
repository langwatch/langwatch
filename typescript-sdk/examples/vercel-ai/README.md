# Vercel AI SDK with LangWatch Observability

This example demonstrates how to use the Vercel AI SDK with LangWatch observability, supporting both LangWatch's native instrumentation and Vercel's OTEL instrumentation.

## Features

- 🤖 Interactive AI chatbot using Vercel AI SDK
- 📊 LangWatch observability integration
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

## Troubleshooting

- **TypeScript errors**: Run `npm run build` to check for compilation errors
- **Missing dependencies**: Run `npm install` to install all dependencies
- **Environment issues**: Ensure your `.env` file is properly configured
