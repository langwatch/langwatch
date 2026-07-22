---
name: evaluations
user-prompt: "Help me evaluate my agent"
description: Compatibility router for LangWatch evaluation requests. Use only when the user asks for evaluations without making it clear whether they mean pre-deployment experiments or production online evaluations. Routes the request to the focused companion skill and does not implement either workflow itself.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
---

# Route an Evaluation Request

This is a compatibility skill. Do not build an experiment, monitor, or guardrail from this skill.

Classify the user's intent:

| Intent                                                                               | Correct skill        |
| ------------------------------------------------------------------------------------ | -------------------- |
| Batch test a dataset, compare prompts or models, benchmark, create a CI quality gate | `experiments`        |
| Score live traces or threads, monitor production quality, create a guardrail         | `online-evaluations` |

If the request remains ambiguous after inspecting context — a bare "make me an eval" that names neither a dataset nor live traffic — do not create anything yet. This choice picks what gets tested, so it is the user's to make, not a default's. Ask one short question naming the two options and wait for the answer:

> Should this test against a dataset before deployment (a batch experiment), or score live production traffic (an evaluator running online)?

Send the question as a single line of prose. (Once the product's choice-question blocks exist, this ask ships as a `langy-card` choices block instead; until then prose is the only channel.)

A rejected field value is not this kind of choice. If a create later fails with a `validation_error` whose reason names the field and an `expected` list, correct that exact field from the list and retry once — never turn a fixable slug into a question for the user.

Then hand off:

1. If the correct companion skill is available, load it and follow it instead of continuing here.

2. If `experiments` is missing, tell the user to install it with:

   ```bash
   npx skills@1.5.19 add langwatch/skills/experiments
   ```

3. If `online-evaluations` is missing, tell the user to install it with:

   ```bash
   npx skills@1.5.19 add langwatch/skills/online-evaluations
   ```

Do not recreate the companion skill's instructions from memory. Load the focused skill so its current workflow, safety checks, and verification steps are used.
