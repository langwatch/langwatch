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

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits — if 3 scenarios are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and direct the user to upgrade at https://app.langwatch.ai/settings/subscription.
- Do NOT delete existing resources to make room, and do NOT reuse a scenario set to cram in more tests.

If `LANGWATCH_ENDPOINT` is set in `.env`, the user is self-hosted — direct them to `{LANGWATCH_ENDPOINT}/settings/license` instead

## Step 1: Read the Prompts CLI Docs

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

**Model:** keep the generated `model` on a current model (the latest OpenAI
generation is `openai/gpt-5.5`). Never downgrade a new prompt to a legacy
model like `gpt-4o-mini`.

**Temperature:** the gpt-5 family rejects a custom `temperature` — do not add
`modelParameters.temperature` for those models. `create` omits it on purpose.

**Structured outputs:** if the prompt must return strict JSON, add a
`response_format` block instead of asking for JSON in prose:

```yaml
response_format:
  name: product_category
  schema:
    type: object
    properties:
      category: { type: string }
      reasoning: { type: string }
    required: [category, reasoning]
    additionalProperties: false
```

`response_format` round-trips losslessly through `sync`/`pull`. See
`langwatch docs prompt-management/cli` for the full format.

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
- Prefer the current flagship (`openai/gpt-5.5`) — pick an older model like `gpt-4o-mini` only when intentionally optimizing for cost or latency
- Do NOT set `modelParameters.temperature` on a gpt-5-family model — it will be rejected
- Do NOT ask for JSON in the prompt text when output must be structured — use a `response_format` block
