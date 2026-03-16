# Guard Rails -- Known Agent Failure Modes

## Testing

- DO NOT invent custom testing frameworks (e.g. `agent_tester`, `simulation_framework`, `langwatch.testing`). Use `@langwatch/scenario` (TS) or `langwatch-scenario` (Python). The Scenario SDK already handles user simulation, judging, multi-turn conversations, and tool call verification.
- DO NOT use regex or word matching in scenario judge criteria. Use natural language criteria with `JudgeAgent` -- it is more robust and meaningful than brittle pattern matching.
- DO NOT use evaluations for multi-turn agent testing. Evaluations are for single input/output metrics (RAG accuracy, classification). Use Scenario tests for multi-turn agent flows.
- DO NOT skip running tests after implementation. Always run scenarios and verify they pass before considering work done. "It should work" is not verification.

## Prompts

- NEVER hardcode prompts in application code or inline strings. Store all prompts in `prompts/*.yaml` files managed by LangWatch Prompt CLI (`langwatch prompt create <name>`, `langwatch prompt sync`).
- DO NOT add try/catch around prompt fetching or duplicate prompts as fallbacks. Prompt CLI files are local and reliable.

## Notebooks

- DO NOT just write Jupyter notebooks without executing them. Evaluation notebooks under `tests/evaluations/` must be run to verify they produce correct results. Writing a notebook is not the same as running it.

## Environment

- DO NOT start long-running dev servers yourself. They block the agent process. Instead, tell the user how to start the server and give them the URL. Let the user run it themselves.
- DO NOT commit `.mcp.json` with real API keys. The `.mcp.json` file contains secrets. Use `.mcp.json.example` with placeholder values for git, and add `.mcp.json` to `.gitignore`.
- DO NOT commit `.env` files. Use `.env.example` for templates. API keys are already in `.env` -- do not re-set them.

## Agent Construction

- DO NOT create agent instances inside loops (especially Agno). Agent construction has significant overhead. Create the agent once, reuse it for multiple queries.

## Documentation

- ALWAYS use the LangWatch MCP (`fetch_langwatch_docs`, `fetch_scenario_docs`) to access documentation. DO NOT fetch docs from random URLs, hallucinate API signatures, or guess framework patterns. Read the actual docs for the specific framework.
- DO NOT use `platform_*` MCP tools when writing code. The `platform_create_scenario`, `platform_create_evaluator`, etc. tools are for no-code platform operations. When you have a codebase, write test files and code instead.

## Workflow

- DO NOT mix kickoff/setup steps with reference documentation. Kickoff instructions (numbered steps the agent executes once) must be clearly separated from ongoing reference material (patterns, rules, examples).
- DO NOT skip verification. After implementation: run scenario tests, check they pass, instrument with LangWatch, confirm traces appear. Only then is the work done.
