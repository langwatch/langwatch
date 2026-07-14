# Contributing to LangWatch MCP Server

Thank you for your interest in contributing to the LangWatch MCP Server! This guide will help you get set up for development and understand our testing approach.

## Development Setup

### Prerequisites

- Node.js and pnpm
- Python with uv package manager
- Git

### Getting Started

1. **Clone the repository and navigate to the MCP server directory:**
   ```bash
   git clone https://github.com/langwatch/langwatch.git
   cd langwatch/mcp-server
   ```

2. **Install dependencies and build the MCP server:**
   ```bash
   pnpm install
   pnpm run build
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Fill in the following required variables in your `.env` file:
   - `LANGWATCH_API_KEY` - Your LangWatch project API key
   - `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude Code integration

4. **Install Python dependencies (for evaluation notebooks):**
   ```bash
   uv sync
   ```

## Testing Approach

This project follows the **[Agent Testing Pyramid](https://scenario.langwatch.ai/best-practices/the-agent-testing-pyramid/)** methodology, which provides a structured approach to testing AI agents across three layers:

### 1. Unit Tests (Foundation)
Traditional software tests for deterministic components like API connections, data pipelines, and error handling.

### 2. Evals & Optimization (Middle Layer)
Component-level evaluation and optimization of probabilistic AI components, including prompt effectiveness and retrieval accuracy.

### 3. Simulations (Peak)
End-to-end testing that validates the complete agent behavior in realistic scenarios.

## Running Tests

### Quick Evaluations (Jupyter Notebook)

For rapid iteration and component testing:

```bash
# Open the evaluation notebook in VS Code/Cursor
code tests/evaluations.ipynb
```

The notebook contains lightweight tests that directly test the MCP server with a "mocked" coding agent on single files. These are useful for:
- Quick validation of MCP tool functionality
- Testing individual instrumentation patterns
- Rapid prototyping of new features

### End-to-End Simulations

For comprehensive system validation:

```bash
pnpm test
```

This runs full simulation tests using the Scenario framework, which:
- Launches actual Claude Code sessions
- Uses the MCP server in a real development environment
- Tests complete workflows on entire codebases
- Validates that the agent can successfully instrument various AI frameworks (OpenAI, LangChain, DSPy, etc.)

When tests run successfully, you'll see:
- LangWatch Scenario interface opening
- Terminal output showing Claude Code using MCP tools
- Validation of code instrumentation at the end of each scenario

## Questions?

If you encounter any issues or have questions about the setup, please:
- Check existing GitHub issues
- Create a new issue with detailed reproduction steps
- Join our Discord community for real-time support

Happy contributing! 🚀
