---
name: create-agent
description: Create a production-ready AI agent project from scratch with LangWatch instrumentation, prompt versioning, evaluation experiments, and scenario tests. Scaffolds complete project structure with your choice of framework (Agno, Mastra, LangGraph, Google ADK, Vercel AI SDK) and LLM provider.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code, Claude Desktop, and similar coding agents.
---

# Create an AI Agent Project from Scratch

This skill scaffolds a complete agent project in an empty directory, fully instrumented with LangWatch. You get tracing, versioned prompts, evaluation experiments, and scenario tests from the start.

## Interactive Discovery

Before scaffolding, gather the following from the user. If any is missing, ask.

**Framework** (pick one):

| Framework | Language | Source Dir |
|-----------|----------|------------|
| Agno | Python | `app/` |
| LangGraph (Python) | Python | `app/` |
| Google ADK | Python | `app/` |
| Mastra | TypeScript | `src/` |
| LangGraph (TypeScript) | TypeScript | `src/` |
| Vercel AI SDK | TypeScript | `src/` |

**LLM Provider** (pick one): OpenAI, Anthropic, Gemini, Bedrock, OpenRouter, Grok

**Project goal**: What does the agent do? (e.g., "customer support agent that answers billing questions")

## Detect Context

Before proceeding, check the target directory:

- **Empty or near-empty** (only README, .git, LICENSE, etc.): Proceed with scaffolding.
- **Contains source code** (`.py`, `.ts`, `.tsx`, `.js` files, `package.json` with dependencies, `pyproject.toml` with dependencies): STOP. Warn the user that this directory already has a project. Suggest using the **tracing** or **level-up** skills instead to add LangWatch to an existing codebase.

## Kickoff Sequence

Execute these 9 steps in order. Do not skip or reorder them.

### Step 1: Read Documentation via MCP

Set up the LangWatch MCP server first so you have access to documentation throughout the process.

See [MCP Setup](_shared/mcp-setup.md) for installation instructions. If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs via URLs.

Once MCP is available:

1. Call `fetch_langwatch_docs` (no args) to see the docs index
2. Read the integration guide for the selected framework
3. Call `fetch_scenario_docs` (no args) to read the Scenario SDK docs
4. Read the Prompts CLI docs at `https://langwatch.ai/docs/prompt-management/cli.md`

Then read the framework reference for the selected framework ONLY:

| Framework | Reference File |
|-----------|----------------|
| Agno | [references/agno.md](references/agno.md) |
| Mastra | [references/mastra.md](references/mastra.md) |
| LangGraph (Python) | [references/langgraph-python.md](references/langgraph-python.md) |
| LangGraph (TypeScript) | [references/langgraph-typescript.md](references/langgraph-typescript.md) |
| Google ADK | [references/google-adk.md](references/google-adk.md) |
| Vercel AI SDK | [references/vercel-ai.md](references/vercel-ai.md) |

Do NOT read references for frameworks the user did not select.

### Step 2: Scaffold Project Structure

Create the full directory tree before writing any application code:

```
my-agent/
├── <app/ or src/>         # Python: app/  |  TypeScript: src/
├── prompts/
├── tests/
│   ├── evaluations/
│   └── scenarios/
├── .env
├── .env.example
├── .mcp.json
├── .mcp.json.example
├── .cursor/mcp.json       # Symlink → ../.mcp.json
├── .gitignore
├── AGENTS.md
├── CLAUDE.md              # Contains: @AGENTS.md
└── pyproject.toml / package.json
```

**`.env.example`** -- committed, placeholder values only:
```
LANGWATCH_API_KEY=your-langwatch-api-key
OPENAI_API_KEY=your-openai-api-key
# Adjust provider key to match the selected LLM provider
```

**`.env`** -- gitignored, real keys from user's environment:
```
LANGWATCH_API_KEY=<actual key if available>
```

**`.mcp.json`** -- gitignored, contains both LangWatch and framework-specific MCP servers. See the framework reference for the framework MCP config. Combine with the LangWatch MCP:
```json
{
  "mcpServers": {
    "langwatch": {
      "command": "npx",
      "args": ["-y", "@langwatch/mcp-server"],
      "env": {
        "LANGWATCH_API_KEY": "<key>"
      }
    }
  }
}
```

**`.mcp.json.example`** -- committed, same structure with placeholder keys.

**`.cursor/mcp.json`** -- create as a symlink to `../.mcp.json` for Cursor compatibility.

**`.gitignore`** -- must include:
```
.env
.mcp.json
.cursor/
__pycache__/
node_modules/
.venv/
```

**`CLAUDE.md`**:
```
@AGENTS.md
```

**`AGENTS.md`** -- see the AGENTS.md Template section below for what to include.

### Step 3: Set Up Language Environment and Install Dependencies

Follow the framework reference for scaffolding commands.

**Python frameworks** (Agno, LangGraph Python, Google ADK):
1. Verify Python is installed: `python3 --version`. If missing, report the error and provide installation guidance. Do not leave a half-scaffolded project.
2. Run the setup commands from the framework reference (e.g., `uv init`, `uv add ...`)
3. Add LangWatch: `uv add langwatch`
4. Add test dependencies: `uv add --dev pytest langwatch-scenario`

**TypeScript frameworks** (Mastra, LangGraph TS, Vercel AI SDK):
1. Verify Node.js is installed: `node --version`. If missing, report the error and provide installation guidance.
2. Run the setup commands from the framework reference (e.g., `pnpm init`, `pnpm add ...`)
3. Add LangWatch: `pnpm add langwatch`
4. Add test dependencies: `pnpm add -D @langwatch/scenario vitest`
5. Set up `tsconfig.json` if not already created by the framework scaffolder

If dependency installation fails, report the error clearly and provide manual installation instructions. Leave the project structure intact so the user can recover.

### Step 4: Instrument with LangWatch Tracing

Follow the integration guide you read in Step 1 for the specific framework. The general patterns are:

**Python:**
```python
import langwatch
langwatch.setup()

@langwatch.trace()
def run_agent(user_input: str):
    # agent logic here
    pass
```

**TypeScript:**
```typescript
import { LangWatch } from "langwatch";
const langwatch = new LangWatch();
```

IMPORTANT: The exact pattern depends on the framework. Follow the docs you read, not these examples.

### Step 5: Create Versioned Prompts via Prompt CLI

1. Install the CLI: `npm install -g langwatch` (or `npx langwatch`)
2. Initialize: `langwatch prompt init`
3. Get the API key: see [API Key Setup](_shared/api-key-setup.md)
4. Create the main prompt: `langwatch prompt create main-prompt`
5. Edit `prompts/main-prompt.yaml` with content tailored to the user's agent goal:
   ```yaml
   model: gpt-4o  # or the selected provider's model
   temperature: 0.7
   messages:
     - role: system
       content: |
         <system prompt tailored to the agent's goal>
     - role: user
       content: |
         {{ user_input }}
   ```
6. Sync: `langwatch prompt sync`
7. Update the agent code to load the prompt via `langwatch.prompts.get("main-prompt")` instead of hardcoding it

Do NOT hardcode prompts in application code. Do NOT add try/catch fallbacks around prompt fetching.

### Step 6: Write Evaluation Experiment

**Python projects** -- create a Jupyter notebook at `tests/evaluations/evaluation.ipynb`:
- Use `langwatch.experiment.init()` to set up the experiment
- Generate a CSV dataset of 10-20 examples tailored to the agent's domain
- Include at least one evaluator (LLM-as-judge for quality is a good default)
- Run the notebook to verify it produces results

**TypeScript projects** -- create a script at `tests/evaluations/evaluation.ts`:
- Use the LangWatch experiments SDK
- Generate a dataset tailored to the agent's domain
- Include at least one evaluator
- Make it runnable with `npx tsx tests/evaluations/evaluation.ts`

Evaluations are for batch metrics on single input/output pairs (RAG accuracy, classification, etc.). Do NOT use evaluations for multi-turn agent testing -- that is what scenarios are for.

### Step 7: Write Scenario Simulation Tests

Use `@langwatch/scenario` (TypeScript) or `langwatch-scenario` (Python) -- NEVER invent a custom testing framework.

1. Read the Scenario docs via MCP: call `fetch_scenario_docs`
2. Create test files in `tests/scenarios/`
3. Write at least one scenario that validates the agent's core behavior:
   - Define an `AgentAdapter` that connects to your agent
   - Use `UserSimulatorAgent` to simulate realistic user messages
   - Use `JudgeAgent` with natural language criteria (NOT regex or string matching)
4. Test multi-turn conversations that verify the agent achieves its goal

### Step 8: Run Tests to Verify

Run the scenario tests:
- Python: `uv run pytest tests/scenarios/`
- TypeScript: `pnpm vitest run tests/scenarios/`

If tests fail, fix the issues and re-run. Do NOT declare the project complete until tests pass. "It should work" is not verification.

### Step 9: Tell the User How to Start

Tell the user the command to start their agent or dev server. Do NOT start it yourself -- long-running processes block the agent.

Examples:
- Agno: `uv run python app/main.py`
- Mastra: `pnpx mastra dev`
- LangGraph Python: `uv run python app/main.py`
- Vercel AI SDK: `pnpm tsx src/index.ts`

Include the URL they can visit if the framework provides a web UI.

## AGENTS.md Template

The generated `AGENTS.md` must include these sections:

```markdown
# <Project Name>

<Brief description of the agent and its goal>

## Development

### Running
<command to start the agent>

### Testing
<command to run scenario tests>

## Principles

### 1. Agent Testing with Scenarios
- Use `@langwatch/scenario` (TS) or `langwatch-scenario` (Python) for testing
- Test multi-turn conversations, not just single exchanges
- Use natural language judge criteria, not regex or string matching
- Run scenarios before considering any change complete

### 2. Prompt Management
- Use LangWatch Prompt CLI: `langwatch prompt create <name>`
- Store prompts in `prompts/*.yaml`, never hardcode in code
- Run `langwatch prompt sync` after changes

### 3. Evaluations vs. Scenarios
- Evaluations: batch metrics for single input/output pairs (RAG, classification)
- Scenarios: multi-turn agent conversation testing
- When in doubt, use scenarios

### 4. Observability
- All LLM calls are traced via LangWatch
- Check traces at https://app.langwatch.ai
```

## Guard Rails

Read [Guard Rails](_shared/guard-rails.md) for the full list. The critical rules:

- **Testing**: Use `@langwatch/scenario` / `langwatch-scenario`. Never invent custom test frameworks. Never use regex in judge criteria. Use natural language criteria with `JudgeAgent`.
- **Prompts**: Use Prompt CLI (`langwatch prompt create`, `langwatch prompt sync`). Never hardcode in code. No try/catch fallbacks.
- **Documentation**: Use MCP (`fetch_langwatch_docs`, `fetch_scenario_docs`) for docs. Never guess URLs or API signatures.
- **Environment**: Never start long-running dev servers. Never commit `.env` or `.mcp.json` with real keys. Use `.example` files for git.
- **MCP tools**: Never use `platform_*` MCP tools (platform_create_scenario, etc.) when writing code. Those are for no-code platform operations.
- **Agent construction**: Never create agent instances inside loops (especially Agno). Create once, reuse.
- **Notebooks**: Always run evaluation notebooks, not just write them. Writing is not verification.
- **Workflow**: Read docs first (Step 1), scaffold second (Step 2), verify last (Step 8). Never skip verification.

## Common Mistakes

| Mistake | Correct Approach |
|---------|-----------------|
| Hardcoding prompts in agent code | Use `langwatch prompt create` and load via `langwatch.prompts.get()` |
| Inventing a custom test framework | Use `@langwatch/scenario` or `langwatch-scenario` |
| Using regex/string matching in scenario judges | Use natural language criteria with `JudgeAgent` |
| Skipping MCP docs and guessing APIs | Call `fetch_langwatch_docs` and `fetch_scenario_docs` first |
| Starting the dev server for the user | Tell the user the command and URL, let them run it |
| Committing `.env` or `.mcp.json` with real keys | Use `.env.example` and `.mcp.json.example` for git |
| Using `platform_*` MCP tools to create scenarios | Write test files in `tests/scenarios/` instead |
| Creating agents inside loops (Agno) | Create the agent instance once, reuse it |
| Writing evaluation notebook without running it | Execute the notebook to verify it produces results |
| Mixing evaluations and scenarios | Evaluations = batch metrics. Scenarios = multi-turn agent tests |
| Reading all framework references | Read ONLY the reference for the selected framework |
| Scaffolding before reading docs | Step 1 is always reading docs via MCP |
