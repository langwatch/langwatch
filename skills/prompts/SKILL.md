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

See [Plan Limits](_shared/plan-limits.md).

## Step 1: Read the Prompts CLI Docs

See [CLI Setup](_shared/cli-setup.md).

Then specifically read the Prompts CLI guide:

```bash
langwatch docs prompt-management/cli
```

CRITICAL: Do NOT guess how to use the Prompts CLI. Read the docs first.

## Step 2: Initialize Prompts in the Project

```bash
langwatch prompt init
```

Creates a `prompts.json` config and a `prompts/` directory in the project root.

## Step 3: Create a Managed Prompt for Each Hardcoded Prompt

Scan the codebase for hardcoded prompt strings (system messages, instructions). For each:

```bash
langwatch prompt create <name>
```

Edit the generated `.prompt.yaml` file to match the original prompt content.

## Step 4: Update Application Code

Replace every hardcoded prompt string with a call to `langwatch.prompts.get()`.

**Python (BAD → GOOD):**
```python
agent = Agent(instructions="You are a helpful assistant.")
```
```python
import langwatch
prompt = langwatch.prompts.get("my-agent")
agent = Agent(instructions=prompt.compile().messages[0]["content"])
```

**TypeScript (BAD → GOOD):**
```typescript
const systemPrompt = "You are a helpful assistant.";
```
```typescript
const langwatch = new LangWatch();
const prompt = await langwatch.prompts.get("my-agent");
```

CRITICAL: Do NOT wrap `langwatch.prompts.get()` in a try/catch with a hardcoded fallback string. The whole point of prompt versioning is that prompts are managed externally. A fallback defeats this by silently reverting to a stale hardcoded copy.

## Step 5: Sync to the Platform

```bash
langwatch prompt sync
```

## Step 6: Tag Versions for Deployment

Three built-in tags: `latest` (auto-assigned), `production`, `staging`. Update code to fetch by tag:

```python
prompt = langwatch.prompts.get("my-agent", tag="production")
```
```typescript
const prompt = await langwatch.prompts.get("my-agent", { tag: "production" });
```

Assign tags via the CLI (or the Deploy dialog in the LangWatch UI):

```bash
langwatch prompt tag assign my-agent production
```

For canary or blue/green deployments, create custom tags with `langwatch prompt tag create`.

## Step 7: Verify

Run `langwatch prompt list` to confirm everything synced, or open the Prompts section in the LangWatch app.

## Common Mistakes

- Do NOT hardcode prompts — always fetch via `langwatch.prompts.get()`
- Do NOT add a hardcoded fallback string in a try/catch — that silently defeats versioning
- Do NOT manually edit `prompts.json` — use the CLI
- Do NOT skip `langwatch prompt sync` after creating prompts
