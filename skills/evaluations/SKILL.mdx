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

If the request remains ambiguous after inspecting context, briefly explain the distinction and route to `experiments` as the safer pre-deployment default.

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
