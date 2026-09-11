# .claude/skills/core/

Not a skill. There is no `SKILL.md` here and nothing in this directory is
discovered or invoked - it is the canonical text of the rules that every skill,
manifest, lane and coordinator would otherwise each restate in their own words.

Three files, three questions:

| File | Answers |
| --- | --- |
| `repository-rules.md` | What may an agent run and edit in this repository? |
| `testing-rules.md` | Which checks does an agent run, and how narrow? |
| `handoff-rules.md` | How does an agent hand work to the next one? |

## How to use it

A skill, brief or prompt **links** to the rule; it does not copy it:

```markdown
Follow `.claude/skills/core/repository-rules.md`. In addition, for this task: ...
```

The point is single-sourcing. When a rule changes it changes here, once, and
every lane started afterwards reads the new text. Two copies drift, and a lane
reading the stale copy is the failure this directory exists to prevent - it is
how lanes came to be working from instructions that had already been superseded.

## What does not belong here

Architecture rules. Where code lives, what a module is, what an app or a
repository is here - that is `architecture-guide` and the `module` skill's
references, and this directory must not restate any of it. These three files
are about *operating the repository*, not about the shape of the code in it.

Incident history, superseded designs and migration narrative do not belong here
either. Those go in `dev/docs/adr/`, `dev/docs/plans/` or a handoff, and are
read when they are relevant rather than loaded into every agent's context.
