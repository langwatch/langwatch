# Metadata and Labels Examples

Two examples demonstrating how to send metadata and labels to LangWatch:

1. **SDK example** (`src/index.ts`) — Uses the LangWatch TypeScript SDK with OpenTelemetry span attributes
2. **REST API example** (`src/rest-api.ts`) — Sends traces directly via HTTP with `fetch` (no SDK required)

## Metadata Fields

### SDK (OpenTelemetry attributes)

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.conversation.id` | string | Thread/conversation ID (OTEL semconv, primary) |
| `langwatch.thread.id` | string | Legacy alias for conversation ID |
| `langwatch.user.id` | string | End user identifier |
| `langwatch.customer.id` | string | Customer/tenant identifier |
| `langwatch.labels` | JSON string | Array of categorization tags |
| `metadata` | JSON string | Custom key-value metadata |

### REST API (`metadata` object)

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | string | End user identifier |
| `thread_id` | string | Conversation/session ID |
| `customer_id` | string | Customer/tenant ID |
| `labels` | string[] | Categorization tags |
| *other keys* | any | Stored as custom metadata |

## Running

1. Create a `.env` file:

```bash
LANGWATCH_API_KEY=your_api_key
OPENAI_API_KEY=your_openai_key  # only needed for SDK example
```

2. Install and run:

```bash
pnpm install

# SDK example (uses LangWatch SDK + OpenAI)
pnpm start

# REST API example (no SDK, just fetch)
pnpm run start:rest-api
```

## Dashboard Features

After running, check your LangWatch dashboard:

- **Conversations**: Messages with the same thread/conversation ID are grouped
- **User Analytics**: Filter traces by user ID
- **Labels**: Filter by labels in the trace list
- **Metadata**: View custom metadata in trace details

## Documentation

See the full guide: [Metadata and Labels](https://docs.langwatch.ai/integration/metadata-and-labels)
