# Handover — comment sweep (wave 7 done, 89%) and the web cycle migration (wave 2 started)

Written 2026-09-16, end of session. **`.claude/coordinator/LANES.md` has no
`active` rows**, so this session was replaceable at the moment it ended and
nothing is in flight.

Two drives ran in parallel earlier. This session ran **drive A only**, at the
user's direction. They are independent; pick either.

## Exact next action

**Wave 8 (the fallible-naming family) is started, not finished.** 145 of 2,104
cleared. The next tranche is **class C**, and it has a ruling already - read
"The naming ruling" below before writing its manifest, because a previous
attempt at this family was reverted wholesale for getting it wrong.

Then: `comment-block-size` still has 659, with `packages/api` and
`packages/architecture-enforcer` still deliberately held.

Drive B (web import cycles) was **not touched in this session** - the
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

## C. The fallible-naming family - wave 8, and the ruling that governs it

| | drive start | now |
| --- | ---: | ---: |
| `fallible-result-naming` + `no-try-prefix` | 2,104 | **1,959** |
| oxlint total | 9,886 (session start) | **9,170** |

Landed: `c859531848` (29 hedges -> 5, 79 files) and `f4d4c4bdce` (83 files across
github, project, user, suite). Served surface verified unchanged on both.

### The naming ruling - read this before writing any manifest for this family

**A `try*` name drops its prefix. `find*` is only for a lookup that may find
nothing.** `find` is not a suffix meaning "returns `T | null`".

The first attempt at this wave was **stopped by the user and reverted
wholesale** - 249 wrong lines across 73 files - for renaming non-lookups to
`find*`: `findSafeRegex` (compiles a pattern), `findJsonArray` / `findJsonValue`
/ `findContentArray` (parse and coerce), `findGroupKeyParts` (derives).

The rule was never asking for that, **and its message says so**: the hedges
branch names the replacement outright - "`tryCompileSafeRegex` hedges ... Name it
`compileSafeRegex` and make the body throw" - and likewise `tryGet` -> `get`,
`trySafeJsonParse` -> `safeJsonParse`. The `find<Noun>` wording belongs to the
*no-try-prefix* message, where it is conditional on the thing genuinely
answering with absence. **Read which message fired.** The correct second attempt
produced `parseGithubPullRequestEvent`, `verifyInstallState`, `consumeNonce`,
`mintTurnToken`, `resolveInstallationForRepository` - each keeping its own verb.

`findRefreshToken` and `findPaths` are **correct** `find*` names: both look
something up.

### The six shapes, measured

| class | count | what it is |
| --- | ---: | --- |
| A | 757 | `try*` rename, no catch claimed |
| C | 688 | nullable - needs `find*` or make it throw. **The next tranche.** |
| B | 429 | repository `get*`/`list*` -> `find*` (legitimate: repositories answer `find*`) |
| D | 175 | add an explicit return type |
| E | 24 | redundant `try` prefix, body unchanged |
| F | 29 | hedges - a real catch to narrow. **Done.** |

The governing doc calls the whole family "Opus, high effort - this is not a
rename". Measured, only class F was. The rule's own census found **96.2% of
flagged `try*` sites have no catch at all**. One opus lane took the 29; sonnet
took the rest. Route the next tranche the same way.

### When a plain throw is itself a regression

Where the failure you stop swallowing is **stored data we wrote that no longer
decodes**, a bare `SyntaxError` at the boundary becomes "unknown error" plus a
trace id - worse than the null it replaced, which at least led the caller
somewhere. Follow the existing convention (`avatar_image_unreadable`,
`model_provider_credentials_unreadable`): a `HandledError` subclass in the
module's `contract/src/<module>.errors.ts`, the code added **sorted** to
`app-codes.ts`, a `presentation.ts` entry, and `fault: "platform"` set
explicitly. `langy_local_record_unreadable` is the worked example.

It does **not** apply to infra failure - the store unreachable - which stays a
plain `Error`. Nor anywhere the remediation will not fit in one sentence.

### And a throw amplifies through lists

langy's list paths loop over ids calling `read()`. Making `read` throw meant one
corrupt record failed a whole listing. **The user's ruling: a single-record read
throws; a list skips the corrupt member and logs it at warn with the id.** The
catch is narrowed with `instanceof` so a Redis outage still propagates. Look for
this shape in every module this family touches next.

### Traps this wave paid for

- **`tslsp-cli diagnostics` cannot be trusted after a rename.** It reported clean
  on two broken files. A rename-APPLY corrupted an unrelated line in
  `prisma.github-pull-requests.repository.ts`, garbling two parameters into
  stray text. Only `typecheck:one` and vitest caught it. **Run the package's real
  typecheck before calling a batch done.**
- **A peer session is doing this same family's work concurrently**, in
  `enterprise/modules/governance`. Select a slice by content fingerprint and
  reconcile it against the lane's own file counts; a directory sweep will
  collect their work.
- **Excluding a peer-dirty file from a revert is not safe** when a lane renamed
  a symbol that file calls. It leaves a dangling call site. That happened here
  (`model-provider.app.ts`) and cost a round trip to find.
- **Renames must be checked against the served surface.**
  `dev/scripts/wire/served-surface.py --diff HEAD <paths>` diffs REST routes and
  tRPC procedures; `getProject` is an operation id as well as a method name.

### Deferred, needing one lane that owns all three paths

`packages/eventing`'s `getKey`, `tryGetProjection` and `tryGet` span
`modules/suite` + `modules/scenario` + `packages/eventing`, and
`tryExtractSuiteId` reaches `modules/scenario`. A lane owning only one of those
will half-land the rename.

### Pre-existing defects found, not caused

- `modules/langy/server/tsconfig.build.json` pointed at `./src/subscribers/`,
  moved to `./src/eventing/` by ADR-137. The package could not typecheck at all
  (TS6053 aborted the load), so **langy-server's typecheck has been vacuously
  passing**. Repointed in `c859531848`; that exposed 6 real errors in 4 untouched
  test files.
- `modules/user/server/src/transport/user-avatar.rest.ts` declares its door as
  `browser` while its declaration test expects `session`. Both clean at HEAD.
- `TestOrganizationService` / `OrganizationApi` fixture drift, 55+ missing
  members across several github and suite fixtures.


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
