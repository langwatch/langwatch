# Vercel AI SDK with LangWatch Observability

This example runs an interactive chatbot on the Vercel AI SDK and traces it with LangWatch's own
`setupObservability()`.

## Features

- Interactive AI chatbot using the Vercel AI SDK
- LangWatch observability through `setupObservability()`
- Markdown formatting for AI responses
- Thread-based conversation tracking

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set up your environment variables:

```bash
cp .env.example .env
# Edit .env with your OpenAI and LangWatch API keys
```

## Usage

```bash
npm start
```

## Why not `@vercel/otel`

langwatch 3.x runs on OpenTelemetry JS 3.x, and `@vercel/otel` (2.3.0 and earlier) needs
OpenTelemetry JS 2.x. To register through `registerOTel()` with `LangWatchExporter`, stay on
langwatch 2.x. `setupObservability()` gives the AI SDK's telemetry spans the same LangWatch export.

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

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key
- `LANGWATCH_API_KEY`: Your LangWatch API key

## Troubleshooting

- **TypeScript errors**: Run `npm run build` to check for compilation errors
- **Missing dependencies**: Run `npm install` to install all dependencies
- **Environment issues**: Ensure your `.env` file is properly configured
