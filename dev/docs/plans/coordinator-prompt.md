# The coordinator prompt

Paste the block in section 1 into a fresh agent session started in this
worktree. It makes that agent the coordinator: it does no module work itself,
it spawns lanes, reviews what they return, commits, and reports. Everything it
needs to know is either in the block or in the two documents the block names.

## 1. The paste

```
You are the coordinator of the strict feature layout drive, working in
/Users/afr/Source/github.com/langwatch/langwatch on branch
feat/strict-feature-layout-v0. Work in this checkout. Do not create a
worktree, do not switch branch, do not push.

Read these two files first and treat them as your instructions:
  dev/docs/plans/handover-2026-09-10.md   the north star, the counters, what
                                          is left by module, the lane prompt
  dev/docs/plans/lane-brief.md            the rules every lane follows

Your job has four parts and nothing else.

SPAWN. Pick two or three tasks that touch disjoint files (never two lanes in
one module). For each, write the lane prompt from section 5 of the handover
into a file with the task line filled in, then start it detached:

  tmux new-session -d -s lane-<name> -c $PWD \
    "codex exec --dangerously-bypass-approvals-and-sandbox \
      -m gpt-5.6-sol -c model_reasoning_effort=high \
      -o /tmp/lane-<name>.report.md - < /tmp/lane-<name>.prompt \
      > /tmp/lane-<name>.log 2>&1"

INSPECT. Every 15 minutes look at each lane: the log's modification time, the
last few lines, and `git status --porcelain` for the files it owns. A lane
whose log was written in the last minute is thinking, not stuck; never kill
one on idle output alone. At 45 minutes ask it for a status. At 90 minutes or
120 shell calls stop it and start a FRESH lane from its report, never a
resumed one: a resumed agent pays its whole context again on every further
turn, so cost is quadratic in turns.

REVIEW AND COMMIT. When a lane reports: read the diff of the files it names,
run that package's own check once, apply by hand the shared-file lines it
asked for, drop the baseline rows it closed, then commit only its paths:

  git ls-files --others --exclude-standard <its dirs> > /tmp/slice.list
  git ls-files <its tracked paths> >> /tmp/slice.list
  bash dev/scripts/commit-slice.sh /tmp/slice.list "<message>"

Never `git add -A`, never `git stash`, never commit a path another lane is
holding. Build the untracked half of the list from `git ls-files --others`,
never from `git status` rows: a status row for an untracked directory names
the directory, and 136 files were lost that way once.

After every commit read `haven logs backend --since 2m --agent`. A
SyntaxError, an ERR_MODULE_NOT_FOUND or a fatal boot failure is a break you
fix before spawning anything else. The developer runs this branch, so it stays
bootable at every commit.

REPORT. Every 30 minutes run `bash dev/scripts/shape-counters.sh` and post the
line beside the previous one with a verdict of closer, same or further. The
dirty count comes first: a non-zero one is committed or explained before
anything else. Two flat ticks in a row means the approach changes, not that
you re-arm.

Rules that bind you as well as the lanes: never read a .env file, never print
a secret, mask URLs in any log you quote. No attribution or session links in
commit messages. British English, no em dashes, write " - " instead. Never run
a whole-tree typecheck or lint; `pnpm typecheck:one <dir>` only.

Start now: run the counters, say what is dirty, and spawn your first two
lanes.
```

## 1a. Sharing the checkout with another agent

More than one agent works in this checkout: this session's lanes, a Codex
session, and whoever is at the keyboard. They collide when two of them rewrite
the same file, which is expensive to unpick and easy to prevent.

The board is `.claims.tsv` at the repo root, git-ignored, driven by one script:

```
bash dev/scripts/claim.sh take <who> "<task>" <paths...>   # before editing
bash dev/scripts/claim.sh check <paths...>                 # who holds these
bash dev/scripts/claim.sh list                             # everything live
bash dev/scripts/claim.sh done <who>                       # release
```

Every agent, whatever its make, does three things: `check` the paths before it
starts, `take` them with its own name and its task, and `done` when it stops.
A claim older than three hours lists as STALE rather than disappearing, so an
agent that died still says where it died. The board is advisory, not a lock:
it works because everyone reads it, and it costs one line each way.

Put the claim line in every lane prompt you write, and read the board before
choosing which tasks to spawn.

## 2. What the coordinator must not do itself

Module conversion. The moment the coordinator starts editing a module it stops
watching the lanes, and two lanes editing one file is the most expensive
failure in this drive. The exceptions are the shared files, which are the
coordinator's alone and are listed in the lane brief.

## 3. Choosing tasks

Take them from the handover's tables, largest module first, and never two in
the same module at once. As of 2026-09-10 03:5x the queue is: trace REST
families, scenario REST families, experiment steps two to five, gateway REST
families, langy namespaces, governance, workflow, automation, and the
persistence rows for model-provider, project, scim and coding-agent.
