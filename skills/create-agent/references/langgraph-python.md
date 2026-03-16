# LangGraph Python Framework Reference

## Language & Package Manager

- **Language:** Python
- **Package manager:** uv
- **Source extensions:** `.py`

## How to Scaffold

```bash
uv init
uv add langgraph langchain-core langchain-openai
```

No dedicated CLI scaffolder. Use `uv init` then add LangGraph dependencies.

## Source Directory Convention

`app/` for main application code.

## Test Runner

pytest

```bash
uv run pytest
```

## LangWatch Integration

Use the LangWatch Python SDK. LangGraph/LangChain integrates via LangChain's callback pattern for tracing.

## Framework MCP Config

Add to `.mcp.json` to get LangGraph and LangChain documentation:

```json
{
  "langgraph-py": {
    "type": "stdio",
    "command": "uvx",
    "args": [
      "--from", "mcpdoc", "mcpdoc",
      "--urls", "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt LangChain:https://python.langchain.com/llms.txt",
      "--transport", "stdio"
    ]
  }
}
```

## Initial Setup Steps

1. `uv init` to create a new project
2. Add dependencies: `uv add langgraph langchain-core langchain-openai`
3. Implement the requested agent logic and write tests
4. Run with `uv run app.py` to validate behaviour

## Core Patterns

- Use the LangGraph MCP for learning about LangGraph and LangChain
- Use LangChain's Python integrations for tools, memory, and models
- Follow LangGraph's node/state patterns when structuring agents
- Leverage LangChain's ecosystem for additional capabilities

## Known Pitfalls

- Always consult the LangGraph MCP for up-to-date API patterns
- Follow LangGraph's node/state architecture rather than freestyle code
- Use LangChain integrations for tools and models rather than raw API calls

## Resources

- Use the LangGraph MCP for up-to-date LangGraph and LangChain documentation
