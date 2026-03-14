---
name: prompt-versioning
description: Version and manage your agent's prompts with LangWatch Prompts CLI. Use when the user wants to track, version-control, and manage their AI prompts as code with A/B testing support.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code and similar coding agents.
---

# Version Your Prompts with LangWatch Prompts CLI

## Step 1: Set up the LangWatch MCP

First, install the LangWatch MCP server so you have access to Prompts CLI documentation:

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs directly via URLs.

## Step 2: Read the Prompts CLI Docs

Use the LangWatch MCP to fetch the Prompts CLI documentation:

- Call `fetch_langwatch_docs` with no arguments to see the docs index
- Find the Prompts CLI page and read it for step-by-step instructions

CRITICAL: Do NOT guess how to use the Prompts CLI. Read the actual documentation first. The CLI has specific commands and workflows that must be followed exactly.

## Step 3: Install and Authenticate the LangWatch CLI

```bash
npm install -g langwatch
langwatch login
```

## Step 4: Initialize Prompts in the Project

```bash
langwatch prompt init
```

This creates a `prompts.json` config and a `prompts/` directory in the project root.

## Step 5: Create Prompts for Each Hardcoded Prompt in the Codebase

Scan the codebase for hardcoded prompt strings (system messages, instructions, etc.) and create a managed prompt for each one:

```bash
langwatch prompt create <name>
```

This creates a `.prompt.yaml` file inside the `prompts/` directory.

## Step 6: Update Application Code to Use Managed Prompts

Replace every hardcoded prompt string with a call to `langwatch.prompts.get()`.

### BAD (Python) -- hardcoded prompt:
```python
agent = Agent(instructions="You are a helpful assistant.")
```

### GOOD (Python) -- managed prompt:
```python
import langwatch
prompt = langwatch.prompts.get("my-agent")
agent = Agent(instructions=prompt.compile().messages[0]["content"])
```

### BAD (TypeScript) -- hardcoded prompt:
```typescript
const systemPrompt = "You are a helpful assistant.";
```

### GOOD (TypeScript) -- managed prompt:
```typescript
const langwatch = new LangWatch();
const prompt = await langwatch.prompts.get("my-agent");
```

CRITICAL: Do NOT wrap `langwatch.prompts.get()` in a try/catch with a hardcoded fallback string. The entire point of prompt versioning is that prompts are managed externally. A fallback defeats this by silently reverting to a stale hardcoded copy.

## Step 7: Sync Prompts to the Platform

```bash
langwatch prompt sync
```

This pushes your local prompt definitions to the LangWatch platform.

## Step 8: Verify

Check that your prompts appear on https://app.langwatch.ai in the Prompts section.

## Common Mistakes

- Do NOT hardcode prompts in application code — always use `langwatch.prompts.get()` to fetch managed prompts
- Do NOT duplicate prompt text as a fallback (no try/catch around `prompts.get` with a hardcoded string) — this silently defeats versioning
- Do NOT manually edit `prompts.json` — use the CLI commands (`langwatch prompt init`, `langwatch prompt create`, `langwatch prompt sync`)
- Do NOT use `platform_` MCP tools — this skill writes code and uses the CLI, not platform resources
- Do NOT skip `langwatch prompt sync` — prompts must be synced to the platform after creation
