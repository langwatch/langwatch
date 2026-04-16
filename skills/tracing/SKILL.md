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

## Detect Context

This skill is code-only — there is no platform path for tracing. If the user has no codebase, explain that tracing requires code instrumentation and point them to the LangWatch docs.

## Step 1: Set up the LangWatch CLI

See [CLI Setup](_shared/cli-setup.md) for installation. The CLI is the only interface — it covers documentation, trace verification, and every other LangWatch operation.

```bash
langwatch trace search --limit 5          # Verify traces arrive
langwatch trace get <traceId>             # Inspect a specific trace
langwatch analytics query --metric trace-count  # Check trace volume
```

If you cannot run the `langwatch` CLI at all (e.g. you are inside ChatGPT or another shell-less environment), see [docs fallback](_shared/llms-txt-fallback.md) for fetching docs over plain HTTP.

## Step 2: Get the API Key

See [API Key Setup](_shared/api-key-setup.md).

Add the API key to the project's `.env` file:
```
LANGWATCH_API_KEY=your-key-here
```

## Step 3: Read the Integration Docs

Use the CLI to fetch the correct integration guide for this project:

```bash
langwatch docs                                 # Browse the docs index
langwatch docs integration/python/guide        # Python guide
langwatch docs integration/typescript/guide    # TypeScript guide
langwatch docs integration/python/langgraph    # Framework-specific (example)
```

Pick the page matching the project's framework (OpenAI, LangGraph, Vercel AI, Agno, Mastra, etc.) and read it before writing any code.

CRITICAL: Do NOT guess how to instrument. Read the actual documentation for the specific framework. Different frameworks have different instrumentation patterns.

## Step 4: Install the LangWatch SDK

For Python:
```bash
pip install langwatch
# or: uv add langwatch
```

For TypeScript:
```bash
npm install langwatch
# or: pnpm add langwatch
```

## Step 5: Add Instrumentation

Follow the integration guide you read in Step 3. The general pattern is:

**Python:**
```python
import langwatch
langwatch.setup()

@langwatch.trace()
def my_function():
    # your existing code
    pass
```

**TypeScript:**
```typescript
import { LangWatch } from "langwatch";
const langwatch = new LangWatch();
```

IMPORTANT: The exact pattern depends on the framework. Always follow the docs, not these examples.

## Step 6: Verify

Do NOT consider the instrumentation complete without verifying it works. Follow these steps in order:

1. **Install dependencies** — run `pip install langwatch` (or `uv add langwatch`) / `npm install langwatch` (or `pnpm add langwatch`). If the install fails due to peer dependency conflicts, widen the conflicting range and retry — do NOT silently skip this step.
2. **Run a quick test** — execute the agent with a simple test input to generate at least one trace. For Python, try running the main script. For TypeScript/Mastra, try running with `npx tsx` or the framework's dev command. Study how the framework starts to find the right approach; only give up if the framework requires infrastructure you cannot spin up (databases, external services, etc.).
3. **Check traces arrived** — use the CLI: `langwatch trace search --limit 5`. If traces show up, instrumentation is confirmed working.
4. **If verification isn't possible** (no CLI access, can't run the code, missing external services), tell the user exactly what to check: "Run your agent and verify traces appear in your LangWatch dashboard at https://app.langwatch.ai". Be specific about what you couldn't verify and why.

## Common Mistakes

- Do NOT invent instrumentation patterns — always read the docs for the specific framework via `langwatch docs`
- Do NOT skip the `langwatch.setup()` call in Python
- Do NOT forget to add LANGWATCH_API_KEY to .env
- Do NOT skip Step 3 (reading the framework-specific doc) — instrumentation patterns vary across OpenAI/LangGraph/Vercel/Mastra/Agno and guessing breaks subtly
