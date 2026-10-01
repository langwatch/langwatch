# .claude/

Project-specific Claude Code configuration for LangWatch.

## Structure

```
.claude/
├── settings.json             # Shared Claude Code project settings
├── agents/                   # Custom subagent definitions (tracked): lane.md - the bounded
│                             # implementation lane, with no Agent tool of its own
├── coordinator/              # The multi-agent workflow protocol (tracked): COORDINATOR.md, LANE.md,
│                             # manifest-template.md, handoff-template.md
├── manifests/                # Runtime state: one task contract per lane, written by the coordinator
│                             # before the lane starts (gitignored except README.md)
├── handoffs/                 # Runtime state: one snapshot per task, rewritten by the lane before it
│                             # stops (gitignored except README.md)
├── skills/
│   ├── core/                 # Not a skill: the canonical rules every agent follows
│   │                         # (repository-rules.md, testing-rules.md, handoff-rules.md)
│   ├── architecture-guide/   # The repository layout reference (contract/server/web, config, install, testing)
│   ├── browser-pair/         # Claude-specific browser pairing workflow
│   ├── browser-test/         # Claude-specific browser test workflow
│   ├── chakra-ui-builder/    # Build UI with Chakra UI v3
│   ├── chakra-ui-migrate/    # Migrate a project from Chakra UI v2 to v3
│   ├── chakra-ui-refactor/   # Review and convert UI code to Chakra UI v3
│   ├── design-system/        # Where LangWatch's components, tokens and Chakra setup live
│   ├── feature-map/          # Claude-specific feature-map workflow
│   ├── haven-setup/          # Haven environment setup workflow
│   ├── langwatch-kanban/     # Manage LangWatch GitHub project board
│   ├── lint-rule/            # Add or change a langwatch oxlint rule
│   ├── mail-template/        # Add or change a transactional email
│   ├── merge-drive/          # Carry a long conflicted merge of main into a restructuring branch
│   ├── module/               # Build or change a module: new, extend, convert, wire, move, web-surface
│   │   └── references/       # One reference per task; SKILL.md routes to them
│   ├── module-review/        # Audit a module, a directory, a diff or a branch, and for over-abstraction
│   │   └── references/       # review-checklist.md, parity.md, over-abstraction.md; SKILL.md routes to them
│   └── spec-bind/            # Bind a Gherkin scenario to the test that proves it
└── README.md
```

## Skills

Each directory under `skills/` except `core/` is one skill: a `SKILL.md` whose
frontmatter description is what makes it trigger, and, for the larger task skills,
a `references/` directory holding the detail. `SKILL.md` stays short (the shape, a
routing table of "you are doing X, read reference Y", the invariants) and the
references carry the procedures, so a session loads only the part of a skill the
task needs.

`skills/core/` is not a skill and has no `SKILL.md`. It holds the canonical rules
every agent in this repository follows, whoever started it: the repository rules
(secrets, scoped checks, git, ownership, identifiers, cost, prose style), the
testing rules, and the handoff rules. Skills, manifests and briefs point at these
files; none restates them.

## The multi-agent workflow

`coordinator/` is the protocol for running a drive with a coordinating agent and a
small number of bounded lanes: `COORDINATOR.md` for the coordinating agent,
`LANE.md` for a lane (including the paste that starts one), and the two
templates. It is tracked; it is the mechanism, independent of any one drive.

What the protocol produces is runtime state and is gitignored, README aside:
`manifests/<task-id>.md` is the contract for one task, written by the coordinator
before the lane starts (owned paths, read-only references, the exemplar, the
budget, the completion criteria); `handoffs/<task-id>.md` is the snapshot the
lane rewrites in place before it stops (what landed, what failed, the exact next
action). A handoff is stale the moment the task moves on, which is why neither
directory's contents survive in git history.

The content of a drive - which modules, which baseline rows, which exemplar
commits, the counters - stays in `dev/docs/plans/`.

`agents/lane.md` is the subagent a lane runs as. It is deliberately thin: it
points at `coordinator/LANE.md` rather than restating it, and carries only what
must survive a terse prompt. Its value is the `tools:` list - a lane gets Read,
Write, Edit, Bash, Grep, Glob and Skill, and **no `Agent` tool**, which turns "no
subagents, no forks" from a rule into a constraint. It pins no `model`, so the
model the coordinator passes at spawn always wins; that is where model routing is
enforced.

## Skill discovery and `.agents/skills`

This is the one skills directory for the repository. `.agents/skills` is a relative
symlink to `skills/` above, kept only so tooling that discovers skills at the older
location still finds the same files. There is nothing under `.agents/skills` that is
not here.

The symlink is not a Claude Code discovery root. `.claude/settings.json` sets
neither `skillDirectories` nor `additionalDirectories`, so Claude Code discovers
project skills at `.claude/skills/` only. The symlink exists for the cross-tool
`.agents/` convention, the one LangWatch's own `langwatch skills install` command
defaults to (`~/.agents`). As configured it cannot cause a skill to be discovered
twice; adding either of those two settings is what would change that.

One property to keep true, because the symlink makes it matter: **no skill name
here may collide with a product skill slug.** The product's shipped skills live
in the top-level `skills/` directory and install by slug, so
`langwatch skills install --dir .agents` resolves through this symlink into
`.claude/skills/<slug>/`. No slug collides today - the product ships `tracing`,
`evaluations`, `scenarios`, `datasets`, `prompts` and the rest, and none of them
names a directory above. The installer also refuses to overwrite content it did
not write, so a collision would be caught rather than silently clobbered, but the
cheaper answer is not to create one. Check the two lists before naming a new
skill in either tree.
