# Add Native Vercel AI SDK Instrumentation Support

## Problem

Vercel AI SDK spans created via `experimental_telemetry` are not being enriched with LangWatch metadata, causing them to appear without proper categorization in the LangWatch dashboard. While the AI SDK creates OpenTelemetry spans with names like `ai.streamText`, `ai.toolCall`, and `ai.embed`, these spans lack the `langwatch.span.type` attribute that LangWatch uses for visualization and analysis.

### Current Behavior

When using Vercel AI SDK with LangWatch:
- AI SDK spans are created locally but lack LangWatch categorization
- Spans appear in traces but aren't properly typed (llm, tool, component)
- Tool calls, embeddings, and LLM operations aren't distinguished in the dashboard
- Users must manually wrap AI SDK calls with LangWatch spans for proper tracking

### Expected Behavior

LangWatch should automatically enrich AI SDK spans with proper metadata:
- `ai.streamText`, `ai.generateText`, `ai.generateObject`, `ai.streamObject` → `llm` type
- `ai.toolCall` → `tool` type
- `ai.embed`, `ai.embedMany` → `component` type
- All existing AI SDK attributes preserved (model info, usage metrics, metadata)

## Solution

Implement `AISDKSpanProcessor` - a SpanProcessor that enriches Vercel AI SDK spans with LangWatch semantic conventions during the span lifecycle.

### Implementation Details

**Core Processor** (`src/observability-sdk/instrumentation/vercel-ai-sdk/index.ts`):
- Implements OpenTelemetry `SpanProcessor` interface
- Enriches spans in `onStart()` before they're exported
- Detects AI SDK spans by `ai.*` prefix
- Maps span names to LangWatch span types using predefined mapping
- Adds enrichment metadata for debugging (`langwatch.ai_sdk.instrumented`, `langwatch.ai_sdk.span_name`)

**Supported Span Types**:
```typescript
const AI_SDK_SPAN_TYPE_MAP = {
  // Text generation
  'ai.generateText': 'llm',
  'ai.streamText': 'llm',
  'ai.generateObject': 'llm',
  'ai.streamObject': 'llm',

  // Provider-level
  'ai.generateText.doGenerate': 'llm',
  'ai.streamText.doStream': 'llm',
  'ai.generateObject.doGenerate': 'llm',
  'ai.streamObject.doStream': 'llm',

  // Tools
  'ai.toolCall': 'tool',

  // Embeddings
  'ai.embed': 'component',
  'ai.embedMany': 'component',
  'ai.embed.doEmbed': 'component',
  'ai.embedMany.doEmbed': 'component',
};
```

**Integration** (`src/observability-sdk/setup/node/setup.ts`):
- Added configuration option `langwatch.enableAISDK` (default: false for backwards compatibility)
- Processor automatically added to span processor chain when enabled
- Works with both batch and simple exporters

**Configuration**:
```typescript
setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
    enableAISDK: true, // Enable AI SDK instrumentation
  }
});
```

## Testing

Comprehensive test coverage added:

**Unit Tests** (`__tests__/index.unit.test.ts`) - 41 tests:
- Span enrichment for all supported AI SDK operations
- Type mapping verification (llm, tool, component)
- Non-AI SDK span filtering
- Error handling and edge cases
- Helper function validation (`isAISDKSpan`, `getAISDKSpanType`, `getSupportedAISDKSpans`)

**Integration Tests** (`__tests__/integration/ai-sdk.integration.test.ts`) - 17 tests:
- Real OpenTelemetry pipeline with InMemorySpanExporter
- Hierarchical span relationships
- Attribute preservation
- Multiple operations in sequence
- Lifecycle management (flush, shutdown)

All 58 tests passing.

## Documentation

Updated documentation:
- `examples/vercel-ai/README.md` - Added AI SDK instrumentation section with usage examples
- Inline JSDoc comments throughout implementation
- Configuration examples and troubleshooting tips

## Benefits

1. **Zero-Config Enrichment**: AI SDK spans automatically categorized without manual span creation
2. **Complete Visibility**: Tool calls, embeddings, and LLM operations properly distinguished in dashboard
3. **Backwards Compatible**: Opt-in via `enableAISDK` flag, no breaking changes
4. **Framework Consistency**: Matches existing LangChain/LangGraph instrumentation patterns
5. **Future-Proof**: Defaults unknown AI SDK spans to `llm` type for forward compatibility

## Related

- Follows same architecture as LangChain instrumentation (`instrumentation/langchain/`)
- Addresses issue discovered in [LANGWATCH_INTEGRATION_TROUBLESHOOTING.md](LANGWATCH_INTEGRATION_TROUBLESHOOTING.md)
- Complements existing Vercel AI SDK examples

## Checklist

- [x] Implementation complete with comprehensive JSDoc
- [x] Unit tests (41 tests, 100% coverage)
- [x] Integration tests (17 tests)
- [x] Documentation updated
- [x] Follows existing code patterns
- [x] Backwards compatible (opt-in feature)
- [x] Error handling for robustness
