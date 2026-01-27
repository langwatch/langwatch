# LangWatch SDK Go E2E Examples

End-to-end examples that connect to real services. These require API keys.

## Prerequisites

Set these environment variables before running:
```bash
export LANGWATCH_API_KEY="lw_..."
export OPENAI_API_KEY="sk-..."
```

## Examples

| Example | Description |
|---------|-------------|
| `openai-simple/` | Basic OpenAI chat completion with LangWatch tracing |
| `openai-filtered/` | Filter spans to only export LangWatch instrumentation |
| `openai-streaming/` | Streaming chat completions |
| `openai-threads/` | Group related interactions with thread IDs |
| `openai-responses/` | OpenAI Responses API integration |
| `custom-input-output/` | Record custom input/output on spans |

## Running Examples

### Using the Runner (Recommended)

```bash
# Run a single example
go run cmd/main.go run-example openai-simple

# Run all examples concurrently
go run cmd/main.go run-examples

# CI mode (streaming output)
go run cmd/main.go --ci run-examples
```

### Running Directly

```bash
go run openai-simple/main.go
```

## Self-Contained Examples

For examples that don't require API keys, see the [`examples/`](../examples/) directory.
