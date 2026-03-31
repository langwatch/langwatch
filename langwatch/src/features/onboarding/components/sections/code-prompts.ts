// Verbatim prompts from https://langwatch.ai/docs/skills/code-prompts
// These are copied to clipboard when users click "copy" in the onboarding UI.

export const PROMPT_TRACING = `Add LangWatch Tracing to Your Code

You are using LangWatch for your AI agent project. Follow these instructions.

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. If not, ask the user for it — they can get one at https://app.langwatch.ai/authorize. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance — use that endpoint instead of app.langwatch.ai.
First, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.

# Add LangWatch Tracing to Your Code

## Determine Scope

If the user's request is **general** ("instrument my code", "add tracing", "set up observability"):
- Read the full codebase to understand the agent's architecture
- Study git history to understand what changed and why — focus on agent behavior changes, prompt tweaks, bug fixes. Read commit messages for context.
- Add comprehensive tracing across all LLM call sites

If the user's request is **specific** ("add tracing to the payment function", "trace this endpoint"):
- Focus on the specific function or module
- Add tracing only where requested
- Verify the instrumentation works in context

## Detect Context

This skill is code-only — there is no platform path for tracing. If the user has no codebase, explain that tracing requires code instrumentation and point them to the LangWatch docs.

## Step 1: Set up the LangWatch MCP

First, install the LangWatch MCP server so you have access to framework-specific documentation:

# Installing the LangWatch MCP

## For Claude Code
Run:
\`\`\`bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey ASK_USER_FOR_LANGWATCH_API_KEY
\`\`\`

Or add to \`~/.claude.json\` or \`.mcp.json\` in the project:
\`\`\`json
{
  "mcpServers": {
    "langwatch": {
      "command": "npx",
      "args": ["-y", "@langwatch/mcp-server"],
      "env": {
        "LANGWATCH_API_KEY": "ASK_USER_FOR_LANGWATCH_API_KEY"
      }
    }
  }
}
\`\`\`

## For other editors
Add to your editor's MCP settings file using the JSON config above.

**Tip:** If \`LANGWATCH_API_KEY\` is already in the project's \`.env\` file, use that same key for the MCP configuration.

If MCP installation fails, see # Fetching LangWatch Docs Without MCP

If the LangWatch MCP cannot be installed, you can fetch docs directly:

1. Fetch the index: https://langwatch.ai/docs/llms.txt
2. Follow links to specific pages, appending \`.md\` extension
3. For Scenario docs: https://langwatch.ai/scenario/llms.txt

Example flow:
1. Fetch https://langwatch.ai/docs/llms.txt to see available topics
2. Fetch https://langwatch.ai/docs/integration/python/guide.md for Python instrumentation
3. Fetch https://langwatch.ai/docs/integration/typescript/guide.md for TypeScript instrumentation to fetch docs directly via URLs.

## Step 2: Get the API Key


**API Key**: Ask the user for their LangWatch API key. They can get one at https://app.langwatch.ai/authorize
Once they provide it, use it wherever you see a placeholder below.
## Step 3: Read the Integration Docs

Use the LangWatch MCP to fetch the correct integration guide for this project:

- Call \`fetch_langwatch_docs\` with no arguments to see the docs index
- Find the integration guide matching the project's framework (OpenAI, LangGraph, Vercel AI, Agno, Mastra, etc.)
- Read the specific integration page for step-by-step instructions

CRITICAL: Do NOT guess how to instrument. Read the actual documentation for the specific framework. Different frameworks have different instrumentation patterns.

## Step 4: Install the LangWatch SDK

For Python:
\`\`\`bash
pip install langwatch
# or: uv add langwatch
\`\`\`

For TypeScript:
\`\`\`bash
npm install langwatch
# or: pnpm add langwatch
\`\`\`

## Step 5: Add Instrumentation

Follow the integration guide you read in Step 3. The general pattern is:

**Python:**
\`\`\`python
import langwatch
langwatch.setup()

@langwatch.trace()
def my_function():
    # your existing code
    pass
\`\`\`

**TypeScript:**
\`\`\`typescript
import { LangWatch } from "langwatch";
const langwatch = new LangWatch();
\`\`\`

IMPORTANT: The exact pattern depends on the framework. Always follow the docs, not these examples.

## Step 6: Verify

Run the application and check that traces appear in your LangWatch dashboard at https://app.langwatch.ai

## Common Mistakes

- Do NOT invent instrumentation patterns — always read the docs for the specific framework
- Do NOT skip the \`langwatch.setup()\` call in Python
- Do NOT forget to add LANGWATCH_API_KEY to .env
- Do NOT use \`platform_\` MCP tools — this skill is about adding code, not creating platform resources`;

export const PROMPT_EVALUATIONS = `Set Up Evaluations for Your Agent

You are using LangWatch for your AI agent project. Follow these instructions.

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. If not, ask the user for it — they can get one at https://app.langwatch.ai/authorize. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance — use that endpoint instead of app.langwatch.ai.
First, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.

# Set Up Evaluations for Your Agent

LangWatch Evaluations is a comprehensive quality assurance system. Understand which part the user needs:

| User says... | They need... | Go to... |
|---|---|---|
| "test my agent", "benchmark", "compare models" | **Experiments** | Step A |
| "monitor production", "track quality", "block harmful content", "safety" | **Online Evaluation** (includes guardrails) | Step B |
| "create an evaluator", "scoring function" | **Evaluators** | Step C |
| "create a dataset", "test data" | **Datasets** | Step D |
| "evaluate" (ambiguous) | Ask: "batch test or production monitoring?" | - |

## Where Evaluations Fit

Evaluations sit at the **component level of the testing pyramid** — they test specific aspects of your agent with many input/output examples. This is different from scenarios (end-to-end multi-turn conversation testing).

Use evaluations when:
- You have many examples with clear correct/incorrect answers
- Testing RAG retrieval accuracy
- Benchmarking classification, routing, or detection tasks
- Running CI/CD quality gates

Use scenarios instead when:
- Testing multi-turn agent conversation behavior
- Validating complex tool-calling sequences
- Checking agent decision-making in realistic situations

For onboarding, create 1-2 Jupyter notebooks (or scripts) maximum. Focus on generating domain-realistic data that's as close to real-world inputs as possible.

## Common Mistakes

- Do NOT say "run an evaluation" — be specific: experiment, monitor, or guardrail
- Do NOT use generic/placeholder datasets — generate domain-specific examples
- Do NOT use \`platform_\` MCP tools for code-based features (experiments, guardrails) — write code
- Do use \`platform_\` MCP tools for platform-based features (evaluators, monitors) when the user wants no-code
- Do NOT skip running the experiment to verify it works
- Monitors **measure** (async), guardrails **act** (sync, via code with \`as_guardrail=True\`) — both are online evaluation
- Always set up \`LANGWATCH_API_KEY\` in \`.env\`
- Always call \`discover_schema\` before creating evaluators via MCP to understand available types
- Do NOT create prompts with \`langwatch prompt create\` CLI when using the platform approach — that's for code-based projects`;

export const PROMPT_SCENARIOS = `Test Your Agent with Scenarios

You are using LangWatch for your AI agent project. Follow these instructions.

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. If not, ask the user for it — they can get one at https://app.langwatch.ai/authorize. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance — use that endpoint instead of app.langwatch.ai.
First, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.

# Test Your Agent with Scenarios

NEVER invent your own agent testing framework. Use \`@langwatch/scenario\` (Python: \`langwatch-scenario\`) for code-based tests, or the platform MCP tools for no-code scenarios. The Scenario framework provides user simulation, judge-based evaluation, multi-turn conversation testing, and adversarial red teaming out of the box. Do NOT build these capabilities from scratch.

## Common Mistakes

### Code Approach
- Do NOT create your own testing framework or simulation library — use \`@langwatch/scenario\` (Python: \`langwatch-scenario\`). It already handles user simulation, judging, multi-turn conversations, and tool call verification
- Do NOT just write regular unit tests with hardcoded inputs and outputs — use scenario simulation tests with \`UserSimulatorAgent\` and \`JudgeAgent\` for realistic multi-turn evaluation
- Always use \`JudgeAgent\` criteria instead of regex or word matching for evaluating agent responses — natural language criteria are more robust and meaningful than brittle pattern matching
- Do NOT forget \`@pytest.mark.asyncio\` and \`@pytest.mark.agent_test\` decorators in Python tests
- Do NOT forget to set a generous timeout (e.g., \`30_000\` ms) for TypeScript tests since simulations involve multiple LLM calls
- Do NOT import from made-up packages like \`agent_tester\`, \`simulation_framework\`, \`langwatch.testing\`, or similar — the only valid imports are \`scenario\` (Python) and \`@langwatch/scenario\` (TypeScript)

### Red Teaming
- Do NOT manually write adversarial prompts -- let \`RedTeamAgent\` generate them systematically. The crescendo strategy handles warmup, probing, escalation, and direct attack phases automatically
- Do NOT create your own red teaming or adversarial testing framework -- use \`@langwatch/scenario\` (Python: \`langwatch-scenario\`). It already handles structured attacks, scoring, backtracking, and early exit
- Do NOT use \`UserSimulatorAgent\` for red teaming -- use \`RedTeamAgent.crescendo()\` (Python) or \`scenario.redTeamCrescendo()\` (TypeScript) which is specifically designed for adversarial testing
- Use \`attacker.marathon_script()\` instead of \`scenario.marathon_script()\` for red team runs -- the instance method pads extra iterations for backtracked turns and wires up early exit
- Do NOT forget to set a generous timeout (e.g., \`180_000\` ms) for TypeScript red team tests since they involve many LLM calls across multiple turns

### Platform Approach
- This approach uses \`platform_\` MCP tools — do NOT write code files
- Do NOT use \`fetch_scenario_docs\` for SDK documentation — that's for code-based testing
- Write criteria as natural language descriptions, not regex patterns
- Create focused scenarios — each should test one specific behavior
- Always call \`discover_schema\` first to understand the scenario format`;

export const PROMPT_PROMPTS = `Version Your Prompts with LangWatch Prompts CLI

You are using LangWatch for your AI agent project. Follow these instructions.

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. If not, ask the user for it — they can get one at https://app.langwatch.ai/authorize. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance — use that endpoint instead of app.langwatch.ai.
First, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.

# Version Your Prompts with LangWatch Prompts CLI

## Common Mistakes

- Do NOT hardcode prompts in application code — always use \`langwatch.prompts.get()\` to fetch managed prompts
- Do NOT duplicate prompt text as a fallback (no try/catch around \`prompts.get\` with a hardcoded string) — this silently defeats versioning
- Do NOT manually edit \`prompts.json\` — use the CLI commands (\`langwatch prompt init\`, \`langwatch prompt create\`, \`langwatch prompt sync\`)
- Do NOT skip \`langwatch prompt sync\` — prompts must be synced to the platform after creation`;

export const PROMPT_ANALYTICS = `Analyze Agent Performance with LangWatch

You are using LangWatch for your AI agent project. Follow these instructions.

IMPORTANT: You will need a LangWatch API key. Check if LANGWATCH_API_KEY is already in the project's .env file. If not, ask the user for it — they can get one at https://app.langwatch.ai/authorize. If they have a LANGWATCH_ENDPOINT in .env, they are on a self-hosted instance — use that endpoint instead of app.langwatch.ai.
First, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.

# Analyze Agent Performance with LangWatch

This skill uses LangWatch MCP tools to query and present analytics. It does NOT write code.

## Common Mistakes

- Do NOT skip \`discover_schema\` -- always call it first to understand available metrics before querying
- Do NOT try to write code -- this skill uses MCP tools only, no SDK installation or code changes
- Do NOT hardcode metric names -- discover them dynamically so they stay correct as the platform evolves
- Do NOT use \`platform_\` MCP tools for creating resources -- this skill is read-only analytics
- Do NOT present raw JSON to the user -- summarize the data in a clear, human-readable format`;

export const PROMPT_LEVEL_UP = `${PROMPT_TRACING}

---

${PROMPT_PROMPTS}

---

${PROMPT_EVALUATIONS}

---

${PROMPT_SCENARIOS}`;
