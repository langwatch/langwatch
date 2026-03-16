# Google ADK Framework Reference

## Language & Package Manager

- **Language:** Python
- **Package manager:** uv
- **Source extensions:** `.py`

## How to Scaffold

```bash
uv init
uv add google-adk
```

No dedicated CLI scaffolder. Use `uv init` then add Google ADK dependencies.

## Source Directory Convention

`app/` for main application code.

## Test Runner

pytest

```bash
uv run pytest
```

## LangWatch Integration

Use the LangWatch Python SDK. Google ADK integrates via the standard Python tracing pattern.

## Framework MCP Config

Add to `.mcp.json` to get Google ADK documentation:

```json
{
  "google-adk": {
    "type": "stdio",
    "command": "uvx",
    "args": [
      "--from", "mcpdoc", "mcpdoc",
      "--urls", "Google-Adk:https://github.com/google/adk-python/blob/main/llms.txt",
      "--transport", "stdio"
    ]
  }
}
```

## Initial Setup Steps

1. `uv init` to create a new project
2. `uv add google-adk` (plus `litellm` if using non-Google models)
3. Set up API key in `.env` (check which env var is needed in app.py)
4. Implement agent logic following Google ADK patterns
5. Run with `uv run app.py` to validate behaviour

## Core Patterns

**Gemini (native):** `Agent(name="my_agent", model="gemini-2.0-flash-exp", ...)`

**Non-Google models (LiteLLM):**
```python
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

agent = Agent(name="my_agent", model=LiteLlm(model="openai/gpt-4.1"), ...)
```

## LLM Provider Configuration

- **Gemini:** Uses Google AI SDK + ADK's native integrations
- **Other providers (OpenAI, Anthropic, etc.):** Uses LiteLLM wrapper inside a Google ADK Agent
- The framework is always Google ADK regardless of model provider -- NEVER switch frameworks
- Use the `.env` file to set the right keys for the chosen provider

## Known Pitfalls

- Google ADK is the framework; the LLM provider is just the model backend -- do not confuse them
- When using non-Google models, always use the LiteLLM wrapper inside ADK Agent
- Never switch to a different agent framework when a non-Google model is selected
- Always consult the Google ADK MCP for up-to-date API patterns

## Resources

- Use the Google ADK MCP for up-to-date documentation
