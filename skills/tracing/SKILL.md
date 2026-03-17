---
name: tracing
description: Add LangWatch tracing and observability to your code. Use for both onboarding (instrument an entire codebase) and targeted operations (add tracing to a specific function or module). Supports Python and TypeScript with all major frameworks.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code and similar coding agents.
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

## Step 1: Set up the LangWatch MCP

First, install the LangWatch MCP server so you have access to framework-specific documentation:

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs directly via URLs.

## Step 2: Get the API Key

See [API Key Setup](_shared/api-key-setup.md).

Add the API key to the project's `.env` file:
```
LANGWATCH_API_KEY=your-key-here
```

## Step 3: Read the Integration Docs

Use the LangWatch MCP to fetch the correct integration guide for this project:

- Call `fetch_langwatch_docs` with no arguments to see the docs index
- Find the integration guide matching the project's framework (OpenAI, LangGraph, Vercel AI, Agno, Mastra, etc.)
- Read the specific integration page for step-by-step instructions

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

Run the application and check that traces appear in your LangWatch dashboard at https://app.langwatch.ai

## Common Mistakes

- Do NOT invent instrumentation patterns — always read the docs for the specific framework
- Do NOT skip the `langwatch.setup()` call in Python
- Do NOT forget to add LANGWATCH_API_KEY to .env
- Do NOT use `platform_` MCP tools — this skill is about adding code, not creating platform resources
