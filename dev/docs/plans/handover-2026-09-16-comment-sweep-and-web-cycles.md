# Handover — comment sweep (wave 7 done, 89%) and the web cycle migration (wave 2 started)

Written 2026-09-16, end of session. **`.claude/coordinator/LANES.md` has no
`active` rows**, so this session was replaceable at the moment it ended and
nothing is in flight.

Two drives ran in parallel earlier. This session ran **drive A only**, at the
user's direction. They are independent; pick either.

## Exact next action

**The comment sweep is no longer the biggest thing in this drive, and the next
tranche should not be one.** `comment-block-size` is down to 662 and is now the
*third* rule; `fallible-result-naming` (1,345) and `no-try-prefix` (757) are one
coherent job of 2,102. That job is **Opus, high effort** and is described in
`dev/docs/plans/handover-2026-09-16-lint-to-zero.md`, wave 2: a `try*` or
nullable-returning method renamed to `find*` must **narrow its catch to the
absence case**, and a blanket catch behind a `find*` name is a worse bug than
the lint it silences. One lane per module, and the lane shows the narrowed catch
in its handoff, not just the rename.

If you do run another comment tranche instead, it is now three commands rather
than a rebuild: the checks are committed at `dev/scripts/comment-sweep/` and are
no longer scratch files. Slice from a fresh measurement, skip the two held areas
below, and exclude peer-dirty paths.

Drive B (web import cycles) was **not touched this session** — the
studio-column-vocabulary decision in section B is still open and still blocks
web-12's dependency deletion.


---

## A. Lint to zero — the comment sweep

Governing doc: `dev/docs/plans/handover-2026-09-16-lint-to-zero.md` (scoreboard,
decisions not to relitigate, traps). Lost facts:
`dev/docs/plans/comment-sweep-lost-facts.md`, now 42 numbered entries.

### Where it stands

| | drive start | previous | now |
| --- | ---: | ---: | ---: |
| oxlint total | 24,022 | 9,886 | **9,357** |
| — `comment-block-size` | 6,168 | 1,177 | **662** |

**5,506 of 6,168 comment findings cleared (89%)**, across 31 areas, in 24 lanes.

This session cleared 515 in three sonnet lanes: `w7-packages-infra` 172
(`0096cfd5eb`), `w7-enterprise-flags` 181 (`4f5fc8520f`), `w7-small-modules` 161
(`6c99d76df5`). The lanes claimed 514 and the tree moved 515 — the extra one is
a block the coordinator deleted in review. **The arithmetic summing exactly also
says no new comment findings appeared during the session**, against the ~12 an
hour the governing doc predicted from concurrent work. Do not read that as the
hole being closed; it was two hours.

### Remaining, largest first

`packages/architecture-enforcer` 85, `packages/api` 68, `skills` 46,
`services/langyworker` 34, `packages/oxlint-rules` 32, `github` 21,
`packages/design-system` 21, `packages/ui-drawer` 19, `modules/notification` 18,
`packages/infrastructure` 18, `packages/otlp` 17, `docs` 17, `modules/monitor`
17, `modules/agent` 16, then 233 across 46 more areas.

The same two are **deliberately held** and were not sliced this session:

- `packages/api` — a peer session is rewriting its REST runtime and declaration
  layer.
- `packages/architecture-enforcer` — coordinator-owned, and it implements the
  rules this drive is measured by. Needs an exclusive grant with the baselines
  carved out, or the coordinator's own hands.

### How to run a tranche

Slice from a **fresh** whole-tree measurement against a current `git status` —
never a stale `.tsv`; the rule's discount list changed mid-drive. Three lanes,
~150-200 findings each, sonnet/medium. The spawn prompt matters more than the
manifest: put the traps in it, because a lane reads its opening prompt twice.

```bash
npx oxlint --config .oxlintrc.jsonc --format=json . > out.json   # count by `code`
```

Exclude every peer-dirty path at slice time. Four sessions share this checkout,
and a lane cannot tell its own edit from someone else's once both are in the
working tree.

### The six checks that collect a slice

**They are committed now.** `dev/scripts/comment-sweep/` holds them with a
README; they were written from scratch in a scratch directory twice and lost
twice, which is why they are in the repository. Run all six — each is unsound
alone and they fail on disjoint inputs.

1. **Scope** — modified set equals the slice exactly. `comm -23` the dirty list
   against the slice file. This is the one that catches peer contamination, and
   it earned its keep this session: it flagged two files in a lane's areas that
   turned out to be a peer's, one of them carrying a code change.
2. **Every changed line inside a comment** — `verify-slice.py`. The sound one.
   Use `--commit SHA` on landed work; without it, pointing at an old ref
   compares the *working tree* to that ref and reports every peer commit since.
3. **Blank lines** — `git diff -U0 | grep -cE '^[+-]$'`. Expect 0-7.
4. **Directives** — no `@ts-`, `<reference>`, `@vitest-environment`,
   `eslint-disable`, `@scenario` removed.
5. **Orphan blocks** — `count-orphans.py`, baseline taken **before** the lane.
6. **Splits** — `count-splits.py`. **New, and it exists because check 5 has a
   gap.** The orphan regex only matches a *single-line* `/** … */` before the
   blank, so a lane that split a multi-line JSDoc from a `//` divider beneath it
   cleared the finding invisibly. Check 6 reports every blank line inserted
   between two comment lines, which is the pattern itself rather than one shape
   of it.

Checks 5 and 6 catch a lane clearing findings by **dividing** a block rather
than shortening it: each half passes, the prose survives, the count falls, and
the comment is detached from what it documented. A lane did this last session
(19 findings, held and corrected at `69d1e405f4`) and a lane did the multi-line
variant this session. Lesson 8 in `.claude/manifests/BRIEF-comment-block-wave1.md`
now states the rule and the brief's old "a blank line splits one block into two,
which is a legitimate fix" wording — the loophole itself — has been removed.

### What review caught this session, beyond lint

Both are in `dev/docs/plans/comment-sweep-lost-facts.md`, entries 39-42.

- A **JSDoc left behind by a move**: the block documenting
  `fillServerOnlyTraceSources` stayed in `evaluation-execution.service.ts` when
  the method moved to `evaluation-data.service.ts:46`, where it is still
  undocumented. It sat between two dividers attached to nothing, and the stale
  `dist/.d.ts` shows it had re-attached to `runEvaluation` — the build output
  documenting one method with the description of another. Deleted, with the
  empty section heading above it. **The follow-up is one comment-only edit:**
  give `fillServerOnlyTraceSources` that sentence at five lines.
- **External contract is checked before it is cut, not assumed.** A lane cut the
  webhook signature header's wire format and its `v1`-may-repeat rotation rule.
  That rule is load-bearing for customers — a verifier reading only the first
  `v1` breaks during a secret roll — so it was confirmed to survive in three
  committed places before the slice was collected (`docs/features/webhooks.mdx:309`,
  the published SDK verifier, `specs/webhooks/signature-vectors.json`). It does.

**Handoffs are gitignored.** A fact a lane records only in its handoff dies with
the drive, so every recorded fact loss was transferred into the committed
register before its slice was collected. Do this every time.


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
