---
name: how-do-i
user-prompt: "How do I …?"
description: Answer a "How do I <topic>?" question by following a baked playbook. The skill resolves the topic to a playbook, loads it, builds a task list from its prerequisites, runs the checks, and follows whichever branch matches. All the domain knowledge lives in the playbook, not here.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface.
---

# Answer a "How do I …?" question

This skill answers questions of the form "How do I `<topic>`?" by following a playbook. The knowledge is in the playbook, not here. Your job is to load the right playbook and follow it exactly.

## Playbooks

| Question | Playbook |
| --- | --- |
| How do I improve my agent's latency? | improve-agent-latency |

If the question matches no row, say so, and offer the closest skill from the skills table instead.

## Procedure

1. **Load the playbook.** Find the slug in the Playbooks table above. First read the file `playbooks/<slug>.md` in this skill's own directory (the `skill` tool reports the skill's base directory; use the file read tool on that directory). If the file is missing, fetch it from the docs site: for `improve-agent-latency` run `langwatch docs playbooks/how-do-i/improve-agent-latency`. If both fail, stop, tell the user the playbook could not be loaded, and do not improvise an answer.
2. **Open a task list.** Use `todowrite`. The first item is the user's goal, worded as an outcome. Then add one item per prerequisite the playbook names. Keep exactly one item in progress at a time.
3. **Run the checks.** Run each prerequisite check as the playbook says. When one fails, follow that branch of the playbook, keep the goal item open (not completed), and tell the user what to do next.
4. **Finish.** When all prerequisites pass, do the playbook procedure. Mark the goal item done only when the answer contains everything the playbook's "What a good answer contains" list asks for.
