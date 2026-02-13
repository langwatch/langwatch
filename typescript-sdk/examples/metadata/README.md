# Metadata and Labels Example

This example demonstrates how to use ALL metadata fields supported by LangWatch:

## Metadata Fields

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.conversation.id` | string | Thread/conversation ID (OTEL semconv, primary) |
| `langwatch.thread.id` | string | Legacy alias for conversation ID |
| `langwatch.user.id` | string | End user identifier |
| `langwatch.customer.id` | string | Customer/tenant identifier |
| `langwatch.labels` | JSON string | Array of categorization tags |
| `metadata` | JSON string | Custom key-value metadata |

## Running

1. Create a `.env` file:

```bash
LANGWATCH_API_KEY=your_api_key
OPENAI_API_KEY=your_openai_key
```

2. Install and run:

```bash
pnpm install
pnpm start
```

## Code Highlights

```typescript
// Set metadata on a span
await tracer.withActiveSpan("HandleMessage", {
  attributes: {
    // Conversation grouping (OTEL semconv)
    "gen_ai.conversation.id": conversationId,
    
    // User identification
    "langwatch.user.id": userId,
    "langwatch.customer.id": customerId,
    
    // Labels (JSON array)
    "langwatch.labels": JSON.stringify(["production", "premium"]),
    
    // Custom metadata (JSON object)
    "metadata": JSON.stringify({
      feature_flag: "v2",
      source: "mobile"
    })
  }
}, async (span) => {
  // Your code here...
});
```

## Dashboard Features

After running, check your LangWatch dashboard:

- **Conversations**: Messages with the same `gen_ai.conversation.id` are grouped
- **User Analytics**: Filter traces by `user_id`
- **Labels**: Filter by labels in the trace list
- **Metadata**: View custom metadata in trace details

## Documentation

See the full guide: [Metadata and Labels](https://docs.langwatch.ai/integration/metadata-and-labels)
