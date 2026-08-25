---
name: level-up
user-prompt: "Take my agent to the next level"
description: Take your AI agent to the next level with full LangWatch integration. Adds tracing, prompt versioning, evaluation experiments, and simulation tests in one go. Use when the user wants comprehensive observability, testing, and prompt management for their agent.
license: MIT
compatibility: Works with Claude Code and similar coding agents. The `langwatch` CLI is the only interface.
---

# Take Your Agent to the Next Level

This skill sets up your agent with the full LangWatch stack: tracing, prompt versioning, evaluation experiments, and agent simulation tests. Each step builds on the previous one.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and note that upgrading the plan raises it. Point to the subscription settings on the platform, or to the license settings on a self-hosted instance.
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

## Prerequisites

## Consultant Mode

After completing all steps, summarize everything you set up and suggest 2-3 ways to go deeper based on what you learned about the codebase. Detailed guidance:

After delivering initial results, transition to consultant mode to help the user get maximum value.

**Phase 1: read first.** Before generating ANY content: read the codebase end-to-end (every system prompt, function, tool definition), study git history for agent-related changes (`git log --oneline -30`, then drill into prompt/agent/eval-related commits because the WHY in commit messages matters more than the WHAT), and read READMEs and comments for domain context.

**Phase 2: quick wins.** Generate best-effort content based on what you learned. Run the tests and iterate, but stop after two attempts at the same failure and report what is blocking it rather than repeating the run. Show the user what works.

**Phase 3: go deeper.** Once Phase 2 lands, summarize what you delivered, then suggest 2-3 specific improvements grounded in the codebase: domain edge cases, areas that need expert terminology or real data, integration points (APIs, databases, file uploads), or regression patterns from git history that deserve test coverage. Ask light questions with options, not open-ended ("Want scenarios for X or Y?", "I noticed Z was a recurring issue. Add a regression test?", "Do you have real customer queries I could use?"). Respect "that's enough" and wrap up cleanly.

Do NOT ask permission before Phase 1 and 2. Deliver value first. Do NOT ask generic questions or overwhelm with too many suggestions. Do NOT generate generic datasets. Everything must reflect the actual domain.

## Step 1: Add Tracing

Add LangWatch tracing to capture all LLM calls, costs, and latency.

1. Read the integration guide for this project's framework:
   ```bash
   langwatch docs                                 # Browse the index to find the right page
   langwatch docs integration/python/guide        # Python (or pick your framework)
   langwatch docs integration/typescript/guide    # TypeScript (or pick your framework)
   ```
2. Install the LangWatch SDK (`pip install langwatch` or `npm install langwatch`)
3. Add instrumentation following the framework-specific guide
4. Add `LANGWATCH_API_KEY` to `.env`

**Verify**: Run the application briefly and confirm traces appear:

```bash
langwatch trace search --limit 5 --format json
```

## Step 2: Version Your Prompts

Move hardcoded prompts to LangWatch Prompts CLI for version control and collaboration.

1. Read the Prompts CLI docs:
   ```bash
   langwatch docs prompt-management/cli
   ```
2. Initialize: `langwatch prompt init`
3. Create prompts: `langwatch prompt create <name>` for each prompt in the code
4. Update application code to use `langwatch.prompts.get("name")` instead of hardcoded strings
5. Sync: `langwatch prompt sync`

**Verify**: `langwatch prompt list` (or check the Prompts section at https://app.langwatch.ai).

Do NOT hardcode prompts in code. Do NOT add try/catch fallbacks around `prompts.get()`.

## Step 3: Create an Evaluation Experiment

Build a batch evaluation to measure your agent's quality across many examples.

1. Read the experiments SDK docs:
   ```bash
   langwatch docs evaluations/experiments/sdk
   ```
2. Analyze the agent's code to understand what it does
3. Generate a dataset of 10-20 examples tailored to the agent's domain (NOT generic examples)
4. Create an experiment file:
   - Python: Jupyter notebook with `langwatch.experiment.init()`, evaluation loop, and evaluators
   - TypeScript: Script with `langwatch.experiments.init()` and `evaluation.run()`
5. Include at least one evaluator (LLM-as-judge for quality is a good default)

**Verify**: Run the experiment (`jupyter nbconvert --to notebook --execute experiment.ipynb` or `npx tsx experiment.ts`) and check results appear in the LangWatch Experiments view.

## Step 4: Add Agent Simulation Tests

Create scenario tests to validate agent behavior in realistic multi-turn conversations.

1. Read the Scenario docs:
   ```bash
   langwatch scenario-docs                  # Browse the index
   langwatch scenario-docs getting-started  # Getting Started guide
   langwatch scenario-docs agent-integration
   ```
2. Install the Scenario SDK (`pip install langwatch-scenario` or `npm install @langwatch/scenario`)
3. Write scenario tests with `AgentAdapter`, `UserSimulatorAgent`, and `JudgeAgent`
4. Use semantic criteria in JudgeAgent (NOT regex matching)

**Verify**: Run the tests (`pytest -s` or `npx vitest run`) and confirm they pass.

NEVER invent your own testing framework. Use `@langwatch/scenario` / `langwatch-scenario`.

## Common Mistakes

- Do NOT skip any step -- each builds on the previous
- Do NOT use generic datasets in the experiment -- tailor them to the agent's domain
- Do NOT hardcode prompts -- use the Prompts CLI
- Do NOT invent testing frameworks -- use Scenario
- Do NOT skip verification steps -- run the application/experiment/tests after each step
- Always read docs via `langwatch docs ...` / `langwatch scenario-docs ...` before writing code; do not work from memory of past framework versions
