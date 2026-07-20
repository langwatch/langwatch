---
name: tracing
user-prompt: "Instrument my code with LangWatch"
description: Add LangWatch tracing and observability to your code. Use for both onboarding (instrument an entire codebase) and targeted operations (add tracing to a specific function or module). Supports Python and TypeScript with all major frameworks.
license: MIT
compatibility: Works with Claude Code and similar coding agents. The `langwatch` CLI is the only interface.
---

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

This skill is code-only — there is no platform path for tracing. If the user has no codebase, explain that tracing requires code instrumentation.

## Step 1: Read the Integration Docs

Use `langwatch docs <path>` to read documentation as Markdown. Some useful entry points:

```bash
langwatch docs                                    # Docs index
langwatch docs integration/python/guide           # Python integration
langwatch docs integration/typescript/guide       # TypeScript integration
langwatch docs prompt-management/cli              # Prompts CLI
langwatch scenario-docs                           # Scenario docs index
```

Discover commands with `langwatch --help` and `langwatch <subcommand> --help`. List and get commands accept `--format json` for machine-readable output. Read the docs first instead of guessing SDK APIs or CLI flags.

If no shell is available, fetch the same Markdown over plain HTTP — append `.md` to any docs path (e.g. https://langwatch.ai/docs/integration/python/guide.md). Index: https://langwatch.ai/docs/llms.txt. Scenario index: https://langwatch.ai/scenario/llms.txt

**Projects and API keys: target a real project, not a personal one.**

LangWatch has two kinds of project:

- **Team / shared projects**: real projects inside an organization. Evaluations, experiments, prompts, datasets, simulations and instrumentation must always target one of these.
- **Personal projects**: a private "My Workspace" scratch space tied to a single user. Never send a user's evaluations, experiments or production traces here: it is for personal exploration only and is easily confused with a real project.

And two ways to authenticate:

- **A project API key in `.env`** (`LANGWATCH_API_KEY`): the credential everything in these skills uses. It is scoped to one real project. This is the default; prefer it unless the user explicitly asks for something else.
- **`langwatch login --device` (AI-tools / SSO)**: a personal device session for wrapping coding assistants (`langwatch claude`, `langwatch codex`, …). It is NOT for evaluations, prompts, datasets, scenarios or SDK instrumentation, and it points at a personal workspace. Do not run it to set up the work in these skills.

So for anything in these skills: make sure `LANGWATCH_API_KEY` for a real, shared project is in the project's `.env`. If it is missing, ask the user for it (they can mint a key for a specific project at https://app.langwatch.ai/authorize). Do NOT run `langwatch login` to pick a project, and never default to a personal project. If `LANGWATCH_ENDPOINT` is set, they are self-hosted, use that endpoint instead of app.langwatch.ai.

Then fetch the integration guide for this project's framework:

```bash
langwatch docs integration/python/guide        # Python (general)
langwatch docs integration/typescript/guide    # TypeScript (general)
langwatch docs integration/python/langgraph    # Framework-specific (example)
```

Pick the page matching the project's framework (OpenAI, LangGraph, Vercel AI, Agno, Mastra, etc.) and read it before writing any code.

CRITICAL: Do NOT guess how to instrument. Different frameworks have different instrumentation patterns; always read the framework-specific guide first.

## Step 2: Install the LangWatch SDK

For Python: `pip install langwatch` (or `uv add langwatch`).
For TypeScript: `npm install langwatch` (or `pnpm add langwatch`).

If install fails due to peer dependency conflicts, widen the conflicting range and retry — do NOT silently skip.

## Step 3: Add Instrumentation

Follow the integration guide you read in Step 1. The general shape is:

**Python:**

```python
import langwatch
langwatch.setup()

@langwatch.trace()
def my_function():
    ...
```

**TypeScript:**

```typescript
import { LangWatch } from "langwatch";
const langwatch = new LangWatch();
```

The exact pattern depends on the framework — follow the docs, not these examples.

## Step 4: Verify

Do NOT consider the work complete without verifying. In order:

1. Confirm dependencies installed cleanly.
2. Run the agent with a test input that produces at least one trace (study how the framework starts; only give up if it requires infrastructure you cannot spin up).
3. Check traces arrived: `langwatch trace search --limit 5`.
4. If verification isn't possible (no shell access, can't run the code, missing external services), tell the user exactly what to check in their LangWatch dashboard and what you couldn't verify and why.

## Common Mistakes

- Do NOT invent instrumentation patterns — read the framework-specific doc
- Do NOT skip `langwatch.setup()` in Python
- Do NOT skip Step 1 — instrumentation patterns vary across OpenAI/LangGraph/Vercel/Mastra/Agno and guessing breaks subtly
