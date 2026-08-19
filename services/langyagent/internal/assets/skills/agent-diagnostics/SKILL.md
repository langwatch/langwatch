---
name: agent-diagnostics
user-prompt: "Diagnose why my agent is misbehaving"
description: Structural root-cause diagnosis of a misbehaving AI agent from its traces. Works through seven ordered dimensions — rubric hygiene, harness hygiene, tool availability, tool-call hygiene, context hygiene, system-prompt hygiene, model strength — cheapest first, and names the dimension the evidence convicts. Use when an agent's quality is bad or a scenario keeps failing and the user wants to know WHY, before deciding what to change. For the fix-it loop afterwards, use agent-improve.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
---

# Agent Diagnostics Playbook

A failing agent has exactly one honest question behind it: *which layer broke?*
The full playbook — seven dimensions checked cheapest-first, each with its
checks and a "convicts when" rule — lives in the docs. Read it first; it is
the single source of truth for this skill:

```bash
langwatch docs agent-simulations/agent-diagnostics-playbook
```

The seven dimensions, in the order the playbook works them:
rubric hygiene → harness hygiene → tool availability and completeness →
tool-call hygiene → context hygiene → system-prompt hygiene → model strength
(last, because it is the expensive conclusion). Each dimension in the playbook
states the bar — what good looks like — before its checks: convict only when
the failing runs measurably fall short of that bar, and frame the fix as
closing the gap to it. At each step, if the evidence convicts, report and
stop — later dimensions are noise until this one is fixed.

**Inputs you need:** recent traces from the agent under diagnosis
(`langwatch trace search --format json`, scope with `--origin` and a time window
so you are reading the agent's own traffic, not your own diagnostic calls), and —
if the complaint is "a scenario/eval keeps failing" — the judge output or
evaluator scores for those runs.

**Output:** a verdict naming ONE primary dimension (plus any secondary), each
claim pointing at a specific trace, span, or judge line, and the single
cheapest fix it implies. Never report "several things could be wrong" — rank
them. Follow the response-format rules — findings, not mechanics.
