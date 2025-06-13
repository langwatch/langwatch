# LangWatch SDK Go Examples

This directory contains example programs demonstrating how to use the LangWatch Go SDK to instrument LLM applications and export traces to LangWatch. Each example is self-contained and shows a different aspect of the SDK's capabilities.

## Prerequisites

- Go 1.22+
- Set the following environment variables before running any example:
  - `LANGWATCH_API_KEY` (your LangWatch API key)
  - `OPENAI_API_KEY` (your OpenAI API key)

## Examples

### 1. `simple/`
A minimal example showing how to instrument a basic OpenAI chat completion with LangWatch and OpenTelemetry. It demonstrates:
- Setting up OTel to export traces to LangWatch
- Instrumenting the OpenAI client
- Sending a simple chat completion and viewing the trace in LangWatch

### 2. `filtered-spans/`
Shows how to filter which spans are exported to LangWatch using a custom OpenTelemetry span processor. Demonstrates:
- Filtering out non-LLM spans (e.g., database, network) so only relevant traces appear in LangWatch
- Custom span processor implementation

### 3. `custom-input-output/`
Demonstrates how to record custom input and output data for LLM spans. Useful for capturing user prompts and model responses explicitly. Shows:
- Using `span.RecordInputString` and `span.RecordOutputString`
- How these appear in the LangWatch UI

### 4. `streaming/`
Shows how to instrument streaming OpenAI chat completions. Demonstrates:
- Capturing streamed responses
- Logging content as it arrives
- Viewing the full streaming journey in LangWatch

### 5. `threads/`
Demonstrates how to group related LLM interactions into threads using a thread ID. Shows:
- Setting a thread ID attribute on spans
- Grouping multiple related messages (e.g., a conversation) in LangWatch

## Running Examples

### Using the Example Runner (Recommended)

The examples include a sophisticated runner tool that provides real-time output display, concurrent execution, and CI-friendly output. From this directory, you can:

**Run a single example:**
```bash
go run cmd/main.go run-example <name>
```

For example:
```bash
go run cmd/main.go run-example threads
go run cmd/main.go run-example simple
```

**Run all examples concurrently:**
```bash
go run cmd/main.go run-examples
```

**CI mode (for testing in environments with streaming terminals):**
```bash
go run cmd/main.go --ci run-examples
```

The runner provides:
- Real-time output with spinners and grouped display
- Concurrent execution of multiple examples
- Error handling and exit codes for CI/CD pipelines
- Clean, organized output formatting

### Running Examples Directly

You can also run examples directly without the runner:
```bash
go run <example>/main.go
```

For example:
```bash
go run threads/main.go
```

## License

See the root of the repository for license information.
