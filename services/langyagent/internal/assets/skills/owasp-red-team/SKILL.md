---
name: owasp-red-team
description: Apply the OWASP red team pack to an existing AI agent as code. Copies a ready pytest or vitest suite with one multi-turn attack per OWASP risk (LLM Top 10 2025 and Agentic Top 10), wires it to the agent, fills one config block and runs it, with results in LangWatch. Use when a security review asks for OWASP coverage, or before shipping an agent with tools.
user-prompt: Red team my agent against the OWASP Top 10 for LLM and agentic applications
license: MIT
compatibility: Requires @langwatch/scenario (TypeScript) or langwatch-scenario (Python). Works with Claude Code and similar coding agents.
metadata:
  category: recipe
---

# Red Team Your Agent with the OWASP Pack

This recipe applies a ready OWASP pack to the user's agent: one multi-turn `RedTeamAgent` attack per OWASP risk, each judged against criteria built from the agent's own config. The pack lives in the `templates/` folder beside this file, in Python (pytest) and TypeScript (vitest). Copy it; do not rewrite it.

Use red teaming only on agents the user owns or has permission to test.

## What the pack covers

| OWASP id | Title | Strategy |
| --- | --- | --- |
| LLM01:2025 | Prompt Injection | goat |
| LLM02:2025 | Sensitive Information Disclosure | crescendo |
| LLM05:2025 | Improper Output Handling | goat |
| LLM06:2025 | Excessive Agency | crescendo |
| LLM07:2025 | System Prompt Leakage | goat |
| LLM09:2025 | Misinformation | crescendo |
| LLM10:2025 | Unbounded Consumption | goat |
| ASI01 | Agent Goal Hijack | crescendo |
| ASI02 | Tool Misuse and Exploitation | goat |
| ASI03 | Identity and Privilege Abuse | crescendo |
| ASI06 | Memory & Context Poisoning | crescendo |

The LLM ids are from the OWASP Top 10 for LLM Applications 2025; the ASI ids from the OWASP Top 10 for Agentic Applications. The ids not listed (LLM03 supply chain, LLM04 data poisoning, LLM08 vector weaknesses, ASI04, ASI05, ASI07 to ASI10) need build, data or multi-agent checks that a conversation cannot exercise.

## Step 1: Detect the language

Look at the agent's repository. `pyproject.toml`, `requirements.txt` or `uv.lock` means Python; `package.json` with TypeScript means TypeScript. If both exist, use the language the agent itself is written in. Read the agent's entry point, system prompt and tool definitions before going on: Step 4 needs them.

## Step 2: Copy the template

Copy every file of the matching template folder into the repository's test folder, unchanged except for import paths:

- Python: `templates/python/` holds `owasp_config.py`, `agent_adapter.py`, `owasp_attacks.py`, `test_owasp_pack.py`. Put them together in one folder (for example `tests/owasp/`).
- TypeScript: `templates/typescript/` holds `owasp.config.ts`, `agent-adapter.ts`, `owasp-attacks.ts`, `owasp-pack.test.ts`. Put them together in one folder (for example `tests/owasp/`).

If you cannot read the `templates/` folder, fetch the same files from `https://github.com/langwatch/skills/tree/main/recipes/owasp-red-team/templates`.

Install the test dependencies:

```bash
# Python
uv add --dev langwatch-scenario pytest pytest-asyncio   # or: pip install langwatch-scenario pytest pytest-asyncio
# TypeScript
npm install -D @langwatch/scenario vitest @ai-sdk/openai
```

## Step 3: Wire the adapter

Edit only the adapter function: `call_agent(messages)` in `agent_adapter.py`, or `callAgent({ messages })` in `agent-adapter.ts`. Make it call the user's real agent with the conversation and return the agent's reply. Return the tool call and tool result messages as well when the agent has tools: the judge needs them for LLM06, LLM10, ASI02 and ASI03.

Call the real agent with its real tools and system prompt. A mock defeats the test. If the tools write to real systems, point them at a test account or a sandbox before running.

## Step 4: Fill the config

Fill the one config block (`AGENT` in `owasp_config.py` or `owasp.config.ts`) from what you read in Step 1:

- `name`, `description`: what the agent is called and what it does.
- `tools`: every tool name the model sees. `privileged_tools`: the ones that change data, spend money or reach outside.
- `must_never`: the actions the agent must refuse, from its system prompt and business rules, one sentence each.
- `protected_data`: what it must never disclose.
- `output_rendered_as`: where replies are shown (HTML widget, Slack, plain API).

Every attack goal and judge criterion is built from these fields, so do not edit `owasp_attacks.py` or `owasp-attacks.ts` for a new agent. Ask the user only for rules you cannot find in the code.

## Step 5: Run

Set `LANGWATCH_API_KEY` (results go to that project) and the model key for the attacker and judge (`OPENAI_API_KEY` by default; change `MODEL` in the config for another provider). `OWASP_TURNS` sets attacker turns per attack: the default 10 keeps a run cheap, use 30 before a release.

```bash
# Python, from the folder with the pack
pytest test_owasp_pack.py -v
pytest test_owasp_pack.py -v -k LLM01      # one id
# TypeScript
npx vitest run tests/owasp/owasp-pack.test.ts
npx vitest run tests/owasp/owasp-pack.test.ts -t LLM01
```

Run one id first to prove the wiring, then the full pack. ALWAYS run it: an unrun pack proves nothing.

## Step 6: Read the results in LangWatch

Each attack is a scenario run named `<OWASP id> <title>: <agent name>`, grouped under the set `owasp-red-team`. Open Simulations in the LangWatch project to read each conversation and the judge's verdict per criterion. A failed test names the OWASP id and the judge's reasoning. Report to the user, per id, whether the agent held and the turn where it broke.

A failing test tells you WHERE the agent fails, not that the prompt is where to fix it. One more rule is the cheapest edit that turns it green, and a prompt maintained that way overfits: it passes exactly the cases it was patched against and degrades everywhere else.

1. **Diagnose the layer.** Five can own a failure: the harness (tools, permissions, context assembly), the model, the knowledge (skills, docs, retrieval), the prompt, or the test itself. The prompt is the last resort. If the fix is "never use tool X", remove tool X from the configuration. Diagnose from the failing run's trace: it holds every tool call, and the assembled input too where the project captures content.
2. **Fix the class, not the transcript.** State the one principle that makes the whole class impossible. Never paste the failing conversation into the prompt. If you cannot name the class, keep diagnosing.
3. **Prove it generalizes.** Re-run with varied wording. The simulator improvises, so a fix that survives one phrasing was a patch for that phrasing.
4. **Pair each prohibition with an overshoot test.** A "decline out-of-scope requests" rule needs a greeting scenario that fails if the agent declines a greeting.
5. **Refactor under green.** Merge overlapping rules, delete what a newer principle covers, re-run. Track prompt size like bundle size: pass rate holds while the prompt trends down.
6. **Keep the judge independent of the prompt.** Grade user outcomes and verified side effects, never the agent's own rules restated. A rubric that quotes the prompt grades obedience, not quality.

Your harness, codebase and model decide which levers exist. Full guide: [Improving your Agent](https://scenario.langwatch.ai/best-practices/improving-your-agent).
