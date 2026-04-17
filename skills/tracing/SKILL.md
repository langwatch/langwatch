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

See [CLI Setup](_shared/cli-setup.md).

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
