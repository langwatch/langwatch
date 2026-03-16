# Agno Framework Reference

## Language & Package Manager

- **Language:** Python
- **Package manager:** uv
- **Source extensions:** `.py`

## How to Scaffold

```bash
uv init
uv add agno openai duckduckgo-search
```

No dedicated CLI scaffolder. Use `uv init` then add agno dependencies.

## Source Directory Convention

`app/` for main application code.

## Test Runner

pytest

```bash
uv run pytest
```

## LangWatch Integration

Use the LangWatch Python SDK. Agno integrates via the standard Python tracing pattern.

## Framework MCP Config

Add to `.mcp.json` to get Agno documentation in your coding assistant:

```json
{
  "agno": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://docs.agno.com/mcp"]
  }
}
```

## Core Patterns

**Basic Agent:**
```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    instructions="You are a helpful assistant",
    markdown=True,
)
agent.print_response("Your query", stream=True)
```

**Agent with Tools:**
```python
from agno.tools.duckduckgo import DuckDuckGoTools

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[DuckDuckGoTools()],
    instructions="Search the web for information",
)
```

**Structured Output:**
```python
from pydantic import BaseModel

class Result(BaseModel):
    summary: str
    findings: list[str]

agent = Agent(model=OpenAIChat(id="gpt-4o"), output_schema=Result)
result: Result = agent.run(query).content
```

## Known Pitfalls

- **NEVER create agents in loops** -- reuse agent instances for performance (significant overhead otherwise)
- Always use `output_schema` for structured responses
- PostgreSQL in production, SQLite for dev only
- Start with single agent (covers 90% of use cases), scale to Team/Workflow only when needed
- Do not forget `search_knowledge=True` when using knowledge bases

## Resources

- https://docs.agno.com/
