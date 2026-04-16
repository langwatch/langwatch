---
name: prompts
user-prompt: "Version my prompts with LangWatch"
description: Version and manage your agent's prompts with LangWatch Prompts CLI. Use for both onboarding (set up prompt versioning for an entire codebase) and targeted operations (version a specific prompt, create a new prompt version). Supports Python and TypeScript.
license: MIT
compatibility: Works with Claude Code and similar coding agents. The `langwatch` CLI is the only interface.
---

# Version Your Prompts with LangWatch Prompts CLI

## Determine Scope

If the user's request is **general** ("set up prompt versioning", "version my prompts"):
- Read the full codebase to find all hardcoded prompt strings
- Study git history to understand what changed and why — focus on agent behavior changes, prompt tweaks, bug fixes. Read commit messages for context.
- Set up the Prompts CLI and create managed prompts for each hardcoded prompt
- Update all application code to use `langwatch.prompts.get()`

If the user's request is **specific** ("version this prompt", "create a new prompt version"):
- Focus on the specific prompt
- Create or update the managed prompt
- Update the relevant code to use `langwatch.prompts.get()`

## Plan Limits

See [Plan Limits](_shared/plan-limits.md) for how to handle free plan limits gracefully. The free plan has a limited number of prompts. Work within the limits and show value before suggesting an upgrade. Do NOT try to work around limits.

## Step 1: Set up the LangWatch CLI

See [CLI Setup](_shared/cli-setup.md) for installation. The CLI is the only interface — it covers documentation, prompt management, and every other LangWatch operation.

The CLI provides all prompt management commands:

```bash
langwatch prompt list                              # List prompts
langwatch prompt init                              # Initialize prompts project
langwatch prompt create <name>                     # Create a prompt YAML
langwatch prompt sync                              # Sync local ↔ remote
langwatch prompt push                              # Push local to server
langwatch prompt pull                              # Pull remote to local
langwatch prompt versions <handle>                 # View version history
langwatch prompt restore <handle> <versionId>      # Rollback to a version
langwatch prompt tag assign <prompt> <tag>         # Tag a version
```

If you cannot run the `langwatch` CLI at all (e.g. you are inside ChatGPT or another shell-less environment), see [docs fallback](_shared/llms-txt-fallback.md) for fetching the same docs over plain HTTP.

## Step 2: Read the Prompts CLI Docs

Use `langwatch prompt --help` to see all available commands, or fetch documentation directly via the CLI:

```bash
langwatch docs prompt-management/cli                 # Prompts CLI guide
langwatch docs                                       # Full docs index
```

CRITICAL: Do NOT guess how to use the Prompts CLI. Read the actual documentation or `--help` output first.

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

## Step 8: Set Up Tags for Deployment Workflows

Tags let you label specific prompt versions for deployment stages. Three built-in tags exist:

- **latest** — auto-assigned to the newest version on every save
- **production** — for the version your production app should use
- **staging** — for the version your staging environment should use

### Fetching by Tag

Update application code to fetch by tag instead of bare slug:

**Python:**
```python
prompt = langwatch.prompts.get("my-agent", tag="production")
```

**TypeScript:**
```typescript
const prompt = await langwatch.prompts.get("my-agent", { tag: "production" });
```

### Assigning Tags

Use the CLI to assign `production` or `staging` tags to a specific version (or use the Deploy dialog in the LangWatch UI):

```bash
langwatch prompt tag assign my-agent production              # Tag latest version
langwatch prompt tag assign my-agent production --version 5  # Tag a specific version
```

### Shorthand Syntax

In config files or anywhere a prompt identifier is accepted, you can use shorthand: `my-agent:production` instead of passing a separate tag parameter.

### Custom Tags

Create custom tags via `langwatch prompt tag create <name>` for workflows like canary releases or blue-green deployments.

## Step 9: Verify

Check that your prompts appear on https://app.langwatch.ai in the Prompts section, or run `langwatch prompt list` to see them from the terminal.

## Common Mistakes

- Do NOT hardcode prompts in application code — always use `langwatch.prompts.get()` to fetch managed prompts
- Do NOT duplicate prompt text as a fallback (no try/catch around `prompts.get` with a hardcoded string) — this silently defeats versioning
- Do NOT manually edit `prompts.json` — use the CLI commands (`langwatch prompt init`, `langwatch prompt create`, `langwatch prompt sync`)
- Do NOT skip `langwatch prompt sync` — prompts must be synced to the platform after creation
- Do NOT skip reading the docs (`langwatch docs prompt-management/cli`) before editing — the YAML format and CLI flags evolve, do not rely on memory
