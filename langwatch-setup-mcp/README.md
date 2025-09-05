# LangWatch Setup Assistant 🏰 MCP Server

The LangWatch Setup Assistant is an MCP server designed to help developers integrate and set up LangWatch in their applications. It provides comprehensive guidance, code examples, and troubleshooting help through AI assistants like Cursor, Claude, or Windsurf.

## Features

🚀 **Setup Guides** - Step-by-step integration for Python, TypeScript, and REST API
📝 **Code Examples** - Ready-to-use integration examples for popular frameworks
📚 **Concept Explanations** - Clear explanations of traces, spans, threads, and more
🛠️ **Troubleshooting** - Common issues and solutions
🎯 **Evaluation Setup** - Guide for custom evaluators and LangEvals integration
👥 **Collaboration Tools** - Annotations, queues, and team workflows

## Installation

### Global Installation

```bash
npm install -g @langwatch/setup-mcp-server
```

### From Source

```bash
git clone https://github.com/langwatch/langwatch.git
cd langwatch-setup-mcp
npm install
npm run build
```

## Setup in Cursor 👩‍💻

1. **Open Cursor Settings** (`Cmd + ,` or `Ctrl + ,`)
2. **Navigate to MCP** in the sidebar
3. **Add new MCP server:**
   - **Name**: `LangWatch Setup Assistant`
   - **Type**: `command`
   - **Command**: `npx -y @langwatch/setup-mcp-server`

## Available Tools

### 🚀 `get_setup_guide`

Get comprehensive setup instructions for your language/framework.

**Parameters:**

- `language` (optional): `"python"`, `"typescript"`, `"javascript"`, `"rest_api"`
- `framework` (optional): Framework-specific guidance

**Example:**

```
Ask: "How do I set up LangWatch with Python?"
```

### 📝 `get_integration_example`

Get detailed code examples for specific integrations.

**Parameters:**

- `language`: `"python"`, `"typescript"`, `"javascript"`
- `integration_type` (optional): `"basic"`, `"openai"`, `"anthropic"`, `"custom_llm"`, `"evaluation"`

**Example:**

```
Ask: "Show me how to integrate LangWatch with OpenAI in Python"
```

### 📚 `explain_concepts`

Get clear explanations of LangWatch concepts.

**Parameters:**

- `concept` (optional): `"traces"`, `"spans"`, `"threads"`, `"user_id"`, `"customer_id"`, `"labels"`, `"all"`

**Example:**

```
Ask: "What are traces and spans in LangWatch?"
```

### 🛠️ `get_troubleshooting_help`

Get help with common issues and problems.

**Parameters:**

- `issue` (optional): `"no_traces_appearing"`, `"authentication_error"`, `"performance_impact"`, `"missing_data"`, `"installation_error"`, `"general"`

**Example:**

```
Ask: "My traces aren't appearing in the dashboard, what's wrong?"
```

### 🎯 `get_evaluation_setup`

Guide for setting up evaluations and quality monitoring.

**Parameters:**

- `evaluator_type` (optional): `"custom"`, `"langevals"`, `"built_in"`, `"all"`

**Example:**

```
Ask: "How do I set up custom evaluators in LangWatch?"
```

### 👥 `get_annotation_guide`

Guide for annotations, queues, and team collaboration.

**Parameters:**

- `feature` (optional): `"annotations"`, `"queues"`, `"scoring"`, `"collaboration"`, `"all"`

**Example:**

```
Ask: "How do I set up annotation queues for my team?"
```

## Usage Examples

### Getting Started

```
User: "I'm new to LangWatch, how do I get started?"
Assistant: Uses get_setup_guide() to provide comprehensive onboarding
```

### Language-Specific Help

```
User: "Show me a complete Python integration example with OpenAI"
Assistant: Uses get_integration_example(language="python", integration_type="openai")
```

### Troubleshooting

```
User: "My API key isn't working, getting authentication errors"
Assistant: Uses get_troubleshooting_help(issue="authentication_error")
```

### Understanding Concepts

```
User: "I'm confused about the difference between traces and spans"
Assistant: Uses explain_concepts(concept="traces") and explain_concepts(concept="spans")
```

## Development

### Build

```bash
npm run build
```

### Run Locally

```bash
npm start
```

### Debug Mode

```bash
npm start -- --debug
```

## Documentation Reference

This MCP server is based on the official LangWatch documentation at:

- https://docs.langwatch.ai/
- https://docs.langwatch.ai/llms.txt

## Support

- 📧 [Email Support](mailto:support@langwatch.ai)
- 💬 [Discord Community](https://discord.gg/kT4PhDS2gH)
- 🐛 [GitHub Issues](https://github.com/langwatch/langwatch/issues)

## License

MIT License - see LICENSE file for details.
