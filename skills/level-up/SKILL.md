---
name: level-up
description: Take your AI agent to the next level with full LangWatch integration. Adds tracing, prompt versioning, evaluation experiments, and simulation tests in one go. Use when the user wants comprehensive observability, testing, and prompt management for their agent.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code and similar coding agents.
---

# Take Your Agent to the Next Level

This skill sets up your agent with the full LangWatch stack: tracing, prompt versioning, evaluation experiments, and agent simulation tests. Each step builds on the previous one.

## Plan Limits

See [Plan Limits](_shared/plan-limits.md). The free plan has limits on prompts, scenarios, evaluators, and experiments. Focus on delivering value at each step — make each creation count. Show the user what works before they hit any limits. If you reach a limit, summarize what was accomplished and suggest upgrading at https://app.langwatch.ai/settings/subscription

## Prerequisites

Set up the LangWatch MCP first — you'll need it for every step below.

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs directly.

## Consultant Mode

After completing all steps, don't just stop. See [Consultant Mode](_shared/consultant-mode.md) — summarize everything you set up, then suggest 2-3 ways to go deeper based on what you learned about the codebase.

## Step 1: Add Tracing

Add LangWatch tracing to capture all LLM calls, costs, and latency.

1. Use the LangWatch MCP to fetch the integration guide for this project's framework: call `fetch_langwatch_docs` with no args to see the index, then read the specific framework page
2. Install the LangWatch SDK (`pip install langwatch` or `npm install langwatch`)
3. Add instrumentation following the framework-specific guide
4. Add `LANGWATCH_API_KEY` to `.env`

**Verify**: Run the application briefly and confirm traces appear at https://app.langwatch.ai

## Step 2: Version Your Prompts

Move hardcoded prompts to LangWatch Prompt CLI for version control and collaboration.

1. Use the LangWatch MCP to read the Prompts CLI docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/prompt-management/cli.md`
2. Install the CLI: `npm install -g langwatch` then `langwatch login`
3. Initialize: `langwatch prompt init`
4. Create prompts: `langwatch prompt create <name>` for each prompt in the code
5. Update application code to use `langwatch.prompts.get("name")` instead of hardcoded strings
6. Sync: `langwatch prompt sync`

**Verify**: Check that prompts appear at https://app.langwatch.ai in the Prompts section.

Do NOT hardcode prompts in code. Do NOT add try/catch fallbacks around `prompts.get()`.

## Step 3: Create an Evaluation Experiment

Build a batch evaluation to measure your agent's quality across many examples.

1. Use the LangWatch MCP to read the experiments SDK docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/experiments/sdk.md`
2. Analyze the agent's code to understand what it does
3. Generate a dataset of 10-20 examples tailored to the agent's domain (NOT generic examples)
4. Create an experiment file:
   - Python: Jupyter notebook with `langwatch.experiment.init()`, evaluation loop, and evaluators
   - TypeScript: Script with `langwatch.experiments.init()` and `evaluation.run()`
5. Include at least one evaluator (LLM-as-judge for quality is a good default)

**Verify**: Run the experiment and check results appear in the LangWatch Experiments view.

## Step 4: Add Agent Simulation Tests

Create scenario tests to validate agent behavior in realistic multi-turn conversations.

1. Use the LangWatch MCP to read Scenario docs: call `fetch_scenario_docs` with no args for the index
2. Install the Scenario SDK (`pip install langwatch-scenario` or `npm install @langwatch/scenario`)
3. Write scenario tests with `AgentAdapter`, `UserSimulatorAgent`, and `JudgeAgent`
4. Use semantic criteria in JudgeAgent (NOT regex matching)

**Verify**: Run the tests and confirm they pass.

NEVER invent your own testing framework. Use `@langwatch/scenario` / `langwatch-scenario`.

## Common Mistakes

- Do NOT skip any step -- each builds on the previous
- Do NOT use generic datasets in the experiment -- tailor them to the agent's domain
- Do NOT hardcode prompts -- use the Prompts CLI
- Do NOT invent testing frameworks -- use Scenario
- Do NOT use `platform_` MCP tools -- this skill writes code in the project
- Do NOT skip verification steps -- run the application/experiment/tests after each step
