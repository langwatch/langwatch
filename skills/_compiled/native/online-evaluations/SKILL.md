---
name: online-evaluations
user-prompt: "Set up online evaluations for my agent"
description: Configure LangWatch online evaluations and guardrails for production traffic. Use when the user wants to score live traces or threads, monitor production quality, sample incoming traffic, or synchronously block unsafe requests and responses. Do not use for batch experiments.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
---

# Set Up Online Evaluations and Guardrails

Online evaluations apply reusable evaluators to production traffic:

- An online evaluation measures live traces or threads asynchronously.
- A guardrail runs synchronously and can stop or replace unsafe traffic.

## Hand Off Batch Testing Requests

If the user wants to test a dataset, compare prompts or models, benchmark, or create a CI quality gate, this is the wrong workflow.

1. If the `experiments` skill is available, load it and follow it now.
2. Otherwise, tell the user to install it with:
   ```bash
   npx skills add langwatch/skills/experiments
   ```

Do not create a batch experiment from this skill.

## Choose the Production Workflow

Use an online evaluation when the user wants continuous scoring, quality trends, sampling, or evaluation by trace or thread.

Use a guardrail when the result must affect the request or response immediately, such as jailbreak detection, PII blocking, or policy enforcement.

If the user's wording is broad, inspect the application and choose the safer non-blocking online evaluation unless they explicitly require synchronous enforcement.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 scenarios are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and direct the user to upgrade at https://app.langwatch.ai/settings/subscription.
- Do NOT delete existing resources to make room, and do NOT reuse a scenario set to cram in more tests.

If `LANGWATCH_ENDPOINT` is set in `.env`, the user is self-hosted. Direct them to `{LANGWATCH_ENDPOINT}/settings/license` instead.

## Prerequisites

Use `langwatch docs <path>` to read documentation as Markdown. Some useful entry points:

```bash
langwatch docs                                    # Docs index
langwatch docs integration/python/guide           # Python integration
langwatch docs integration/typescript/guide       # TypeScript integration
langwatch docs prompt-management/cli              # Prompts CLI
langwatch scenario-docs                           # Scenario docs index
```

Discover commands with `langwatch --help` and `langwatch <subcommand> --help`. List and get commands accept `--format json` for machine-readable output. Read the docs first instead of guessing SDK APIs or CLI flags.

If no shell is available, fetch the same Markdown over plain HTTP. Append `.md` to any docs path (e.g. https://langwatch.ai/docs/integration/python/guide.md). Index: https://langwatch.ai/docs/llms.txt. Scenario index: https://langwatch.ai/scenario/llms.txt

**Projects and API keys: target a real project, not a personal one.**

LangWatch has two kinds of project:

- **Team / shared projects**: real projects inside an organization. Evaluations, experiments, prompts, datasets, simulations and instrumentation must always target one of these.
- **Personal projects**: a private "My Workspace" scratch space tied to a single user. Never send a user's evaluations, experiments or production traces here: it is for personal exploration only and is easily confused with a real project.

And two ways to authenticate:

- **A project API key in `.env`** (`LANGWATCH_API_KEY`): the credential everything in these skills uses. It is scoped to one real project. This is the default; prefer it unless the user explicitly asks for something else.
- **`langwatch login --device` (AI-tools / SSO)**: a personal device session for wrapping coding assistants (`langwatch claude`, `langwatch codex`, …). It is NOT for evaluations, prompts, datasets, scenarios or SDK instrumentation, and it points at a personal workspace. Do not run it to set up the work in these skills.

So for anything in these skills: make sure `LANGWATCH_API_KEY` for a real, shared project is in the project's `.env`. If it is missing, ask the user for it (they can mint a key for a specific project at https://app.langwatch.ai/authorize). Do NOT run `langwatch login` to pick a project, and never default to a personal project. If `LANGWATCH_ENDPOINT` is set, they are self-hosted, use that endpoint instead of app.langwatch.ai.

Read the relevant documentation before changing configuration or code:

```bash
langwatch docs evaluations/online-evaluation/overview
langwatch docs evaluations/online-evaluation/setup-monitors
langwatch docs evaluations/guardrails/overview
langwatch docs evaluations/evaluators/list
```

## Inspect the Existing Setup

Use JSON output and inspect what already exists before creating duplicates:

```bash
langwatch monitor list --format json
langwatch evaluator list --format json
```

Read recent traces only when they are needed to determine mappings, level, sampling, or realistic evaluator inputs. Do not send production data to a different project.

## Create an Online Evaluation

Discover the installed CLI contract first:

```bash
langwatch monitor create --help
```

Then create the monitor with a descriptive name, a valid evaluator type or saved evaluator, and the correct level:

- Use `trace` for per-interaction quality.
- Use `thread` for multi-message outcomes and configure an appropriate idle timeout in the platform when needed.
- Start with a conservative sample rate for expensive evaluators on high-volume traffic.
- Use `ON_MESSAGE` for asynchronous online evaluation.

Do not guess evaluator parameters. Read the evaluator docs and the installed CLI help. If an LLM evaluator is used, verify that the target project has a model provider configured.

After creation, verify the saved resource:

```bash
langwatch monitor list --format json
langwatch monitor get <monitor-id> --format json
```

The task is complete only when the created monitor appears with the intended evaluator, execution mode, level, sample rate, and enabled state.

## Add a Guardrail

For platform-managed guardrails, create or edit the monitor with `AS_GUARDRAIL` after reading `langwatch monitor create --help` or `langwatch monitor update --help`.

For an in-code guardrail, follow the language-specific documentation. A Python integration has this general shape:

```python
import langwatch

@langwatch.trace()
def my_agent(user_input):
    result = langwatch.evaluation.evaluate(
        "azure/jailbreak",
        name="Jailbreak detection",
        as_guardrail=True,
        data={"input": user_input},
    )
    if not result.passed:
        return "I cannot help with that request."

    return generate_response(user_input)
```

Treat the snippet as a shape, not a substitute for the installed docs. Preserve the application's existing error handling and decide explicitly what happens if the guardrail service is unavailable.

## Verify Real Behavior

For an online evaluation:

1. Send or reuse a representative traced interaction in the target project.
2. Confirm the monitor is enabled.
3. Confirm a real evaluation result appears in Online Evaluations analytics.

For a guardrail:

1. Run one allowed input and one input that should be blocked.
2. Verify the allowed path still works.
3. Verify the blocked path does not reach the protected operation.
4. Verify both outcomes are traced without exposing sensitive content.

## Common Mistakes

- Do not create a batch experiment from this skill.
- Do not describe a synchronous guardrail as asynchronous monitoring.
- Do not enable an expensive evaluator on all traffic without considering sampling and cost.
- Do not create duplicate monitors without inspecting the project first.
- Do not claim success after saving configuration. Verify a real monitor or guardrail behavior.
