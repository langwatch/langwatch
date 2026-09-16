# Handover — comment sweep (wave 6 done) and the web cycle migration (wave 2 started)

Written 2026-09-16, end of session. **`.claude/coordinator/LANES.md` has no
`active` rows**, so this session was replaceable at the moment it ended and
nothing is in flight.

Two drives ran in parallel here. They are independent; pick either.

## Exact next action

Take the studio-column-vocabulary decision (section B) before spawning any more
web wave-2 lanes — it blocks web-12's dependency deletion and may block lanes 8,
10 and 11. Everything else is unblocked: either slice the next comment tranche
from a fresh measurement (three lanes, sonnet, ~150-200 findings each), or spawn
web lanes 7, 8, 9, 10, 11, 14, 15, whose paths are now all free.


---

## A. Lint to zero — the comment sweep

Governing doc: `dev/docs/plans/handover-2026-09-16-lint-to-zero.md` (scoreboard,
decisions not to relitigate, traps). Lost facts:
`dev/docs/plans/comment-sweep-lost-facts.md`, now 38 numbered entries.

### Where it stands

| | drive start | now |
| --- | ---: | ---: |
| oxlint total | 24,022 | **9,884** |
| — `comment-block-size` | 6,168 | **1,175** |
| architecture-enforcer | 3,137 | 2,840 (not comparable — see the lint-to-zero doc) |
| **true total** | **27,159** | **12,724** |

**4,993 of 6,168 comment findings cleared (81%)**, across 28 areas, in 21 lanes.
`comment-block-size` is no longer the biggest rule — `fallible-result-naming`
(1,347) is. The next tranche of this drive is arguably not the comment sweep.

### Remaining, largest first

`packages/architecture-enforcer` 85, `packages/api` 68, `skills` 46,
`packages/test-harness` 45, `enterprise/modules/billing` 43,
`modules/feature-flag` 41, `packages/mail` 38, `packages/observability` 37,
`modules/data-privacy` 35, `services/langyworker` 34, `packages/egress` 33,
`enterprise/modules/licensing` 32, then a tail across 73 areas.

Two of those are **deliberately held**:

- `packages/api` — the peer session is rewriting its REST runtime and
  declaration layer. Sweeping comments through a file someone is restructuring
  wastes both efforts.
- `packages/architecture-enforcer` — coordinator-owned, and it implements the
  rules this drive is measured by. Needs an exclusive grant with the baselines
  carved out, or the coordinator's own hands.

### How to run a tranche

Slice from a **fresh** whole-tree measurement against a current `git status` —
never a stale `.tsv`; the rule's discount list changed mid-drive. Three lanes,
~150-200 findings each, sonnet/medium. The spawn prompt matters more than the
manifest: put the traps in it, because a lane reads its opening prompt twice.

### The five checks that collect a slice

Run all five. Each is unsound alone and they fail on disjoint inputs.

1. **Scope** — modified set equals the slice exactly. `comm -23` the dirty list
   against the slice file; anything extra is the peer session's and must not be
   committed.
2. **Every changed line inside a comment** — `verify-slice.py` (below). This is
   the sound one.
3. **Blank lines** — `git diff -U0 | grep -cE '^[+-]$'`. Legitimate only to
   split two adjacent comment blocks the rule counts as one. Expect 0-7.
4. **Directives** — no `@ts-`, `<reference>`, `@vitest-environment`,
   `eslint-disable`, `@scenario` removed. Moving a discounted tag *into* a JSDoc
   as its own ` * @tag` line is a good fix and is the repo's dominant form
   (1,292 files, 746 of them `jsdom` where a broken directive would fail loudly).
5. **Orphan blocks** — the regex below must not increase. **This is the check
   that catches a lane gaming the rule**, and no other check can see it.

```python
import re
pat = re.compile(r"^[ \t]*/\*\*[^\n]*\*/[ \t]*\n[ \t]*\n[ \t]*/\*\*", re.M)
```

A lane this session cleared 19 findings by **splitting** an over-budget block
into a one-line block, a blank line, and the remainder. Each half passes; the
prose survives; and the first block is orphaned, because only the JSDoc
immediately preceding a declaration attaches to it. The slice was fully
lint-clean and provably comment-only and still wrong. It was held, corrected by
a 14-file lane, and collected at `69d1e405f4`. Every other lane added zero
orphan blocks — that outlier comparison is what exposed it.

### `verify-slice.py`

Lives in the job scratch dir, so **it will not survive**. Rewrite it; it is
about 60 lines. It computes the set of lines inside a comment in each version —
including JSX `{/* … */}` and their unmarked continuation lines — and asserts
every removed line was inside one and every added line is inside one.

It replaced two checks that were each unsound:

- the changed-line pattern grep is blind to JSX continuation lines, which carry
  no `*` and so read as code;
- a character-scanning strip-and-compare treated `/*` inside a **regex literal**
  as opening a block comment and a backtick inside a **comment** as opening a
  template literal. Once desynced it consumed to the next `*/`, so how far it
  ran depended on comment length — editing only comments changed its verdict.
  Four false positives in one wave.

Give it a `--commit SHA` mode. Without one, pointing it at an old ref compares
the *working tree* against that ref and reports every commit landed since,
including the peer's, which reads as a false alarm. That nearly cost a wrong
report this session.

---

## B. Web package boundaries — the import cycles

Governing docs, **both committed today** at `435e4f7856` (they were untracked,
56KB of approved analysis living only in a working tree):

- `dev/docs/plans/web-package-boundaries-options.md` — what the cycles are made
  of, five ways out, the recommendation.
- `dev/docs/plans/web-package-boundaries-migration.md` — the approved 16-lane
  plan in three waves. Section 4 is the lane table; section 5 maps every cycle
  to the edge that deletes it; section 8 is the peer conflict.

All 17 lane manifests exist as `.claude/manifests/web-*.md`.

### Where it stands

`lintCycles` reports **22** findings, 3 naming `-contract` packages, so **19 web
cycles**. It was 25/3 at the start of this session — the three deleted are the
migration's first actual cycle reductions rather than groundwork.

**Wave 1 (lanes 1-6) is complete and committed:**

| lane | commit |
| --- | --- |
| web-1 declaration seam | `4571a42bcc`, populated by `ccc42c6e91` (20 features declared, 88 baseline rows retired) |
| web-2 shared homes | `d65b95c327`, completed by `304d396d1c` |
| web-3 contract moves | `9d9ee325cc` — four types moved, the fifth withheld |
| web-4 agent contract | handoff `review`, batch A committed |
| web-5 flat outliers | `973b6964c3` |
| web-6 coding-agent drawer | handoff `complete` |

**Wave 2 (lanes 7-15): two done, seven to go.**

- `web-12-dataset` — `25925cdecd`, **partial**. See the blocker below.
- `web-13-analytics-model-provider` — `105dfbcecc` + lockfile `fabc722b50`.
  Four dependency edges deleted; cycles 25 → 22.
- Not started: 7, 8, 9, 10, 11, 14, 15. All unblocked by dependency; they were
  only waiting on the lane ceiling and on comment lanes holding their paths.

**Wave 3 (lane 16, trace cutover) is peer-blocked.** The other session is
actively editing `modules/trace` — it committed `2722423f6f` and `651625d14f`
there today. Do not start lane 16 until that session confirms it is done.

### The decision blocking further deletions — read this first

`web-12`'s whole purpose was dropping `@langwatch/workflow-web` from
`modules/dataset/web`. **It could not.** `studio-dataset-columns` still lives in
workflow-web, because `web-3` *declined* to move it — moving it as-is would
close a cycle (that is the "fifth stays out" in `9d9ee325cc`).

So the plan counts that edge as deleted and it is not. The resolution is an
architecture decision above a sonnet lane: **which package hosts studio column
vocabulary**, and specifically the three-way split between dataset-only
vocabulary, the five workflow-shaped conversions, and a home for
`tryToMapPreviousColumnsToNewColumns` that is free of workflow-web.

This is not one lane's problem. Lanes 8, 10 and 11 have deletion batches that
may hit the same wall. **Take this decision, or open an Opus lane for it, before
spawning more wave-2 lanes.**

---

## Lockfile discipline — a mistake made and corrected today

I committed `modules/dataset/web/package.json` with a new dependency and **not**
`pnpm-lock.yaml`. Every clean checkout then failed `pnpm install` with
`ERR_PNPM_OUTDATED_LOCKFILE` before anything else could run. The peer session
caught it: `5ca718aa1d`.

1. A commit changing any `package.json` dependency set carries the lockfile with
   it. `pnpm install --lockfile-only` updates the lockfile without touching
   `node_modules`, so it is safe to run while lanes are working.
2. **Regenerating the lockfile absorbs every other session's uncommitted
   `package.json` edits**, because it derives from disk, not HEAD. Committing
   that wholesale publishes a lockfile describing manifests nobody committed,
   breaking a clean install exactly as badly as omitting it. Diff the lockfile by
   *importer*, and restore any importer that is not yours to its HEAD block.
   `fabc722b50` does this.

---

## Things that are decisions, not tasks

Three are open and none should be taken by a lane:

1. **Which package hosts studio column vocabulary** (above). Blocks web-12 and
   possibly 8, 10, 11.
2. **53 inert `biome-ignore` comments.** Biome is not in this toolchain — no
   `biome.json`, no dependency, no script. All 53 are inert. Delete them, keep
   them as documentation, or convert the ones with an oxlint equivalent. Eight
   over-long ones were reworded rather than deleted (`47f42c4ca7`), which
   pre-judges nothing.
3. **A home for two `dev/scripts` headers.** `check-queue.mjs` (58 lines, the
   environment contract for `CHECK_SLOTS`/`CHECK_QUEUE_HELD`/`CHECK_PRESSURE`)
   and `dev-supervisor.mjs` (140 lines plus a 132-column line, the PID table
   that *is* the process-group argument). Neither fits 5 lines; neither should
   be deleted. A `dev/docs/` page each, or an ADR plus `--help` text.

And one defect found, not caused, by the sweep: **six shipped source files cite
gitignored `.claude/` paths**. `modules/project/server/src/app/project.app.ts:85`
explains why the app refuses to boot in `apps/worker` and defers the reasoning
to a handoff no clone contains. Full list in the lost-facts register. The fix is
moving the content into committed docs and repointing.

---

## Working practices worth carrying

- **Read `.claude/handoffs/` before spawning anything.** I spawned web-1 and
  web-2 as "first attempts" when both had run the day before and were committed.
  A manifest says what a lane should do; only the handoff says whether it already
  did. Both directories are gitignored, so neither survives a clone.
- **This shell is zsh.** Unquoted `$var` does not word-split. `files=$(... | tr
  '\n' ' ')` then `oxlint $files` passes ONE non-existent path and reports zero
  findings — a false pass that fooled three agents on this task, and once fell
  through to linting the whole repository. Use `mapfile -t F < list` inside
  `bash -c`, and echo the element count.
- **Never `git checkout` or `git stash` a shared file.** `pnpm-lock.yaml` was
  dirty with the peer's work throughout; reverting it would have destroyed that.
- Scratch files go in a per-job directory, never a guessable `/tmp` path — a lane
  wrote `/tmp/w4-files.txt` and read back a different lane's file list.
