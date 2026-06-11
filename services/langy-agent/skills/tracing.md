# Skill: Tracing

**Purpose**: Instrument code with LangWatch observability — add LLM call tracing across an agent's codebase.

**When to use**: User asks to "set up tracing", "instrument my code", "add observability", "track LLM calls".

**Workflow**:
1. Read the user's codebase to understand the agent architecture (frameworks, LLM providers in use).
2. Install the LangWatch SDK (`pip install langwatch` for Python or `npm install langwatch` for TS).
3. Configure framework-specific instrumentation patterns.
4. Verify traces arrive by calling `search_traces` after a test run.

**Key CLI calls**:
- `langwatch docs integration/python/guide`
- `langwatch docs integration/typescript/guide`
- `langwatch trace search` (verify ingestion)

**Requires**: `LANGWATCH_API_KEY` in `.env`.
