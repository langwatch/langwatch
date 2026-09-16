# Handover: the lint-to-zero drive — 2026-09-16

**ENTRY POINT for the successor coordinator.** Read this, then
`.claude/coordinator/LANES.md` for roster conventions. Every number here was
measured this session, not inherited. Branch `feat/strict-feature-layout-v0`.

## The goal, as the user set it

**Every finding to zero.** Not the CI gate, not errors only — zero. Both halves
of `pnpm lint` count: `lint:oxlint` **and** `architecture-enforcer lint`.

## Scoreboard

| | drive start | handover written | wave 3 | now (wave 4 landed) |
| --- | ---: | ---: | ---: | ---: |
| oxlint errors | 6,075 | 13,253 | 9,771 | **9,208** |
| oxlint warnings | 17,947 | 1,631 | 1,632 | **1,632** |
| oxlint total | 24,022 | 14,884 | 11,403 | **10,840** |
| — of which `comment-block-size` | 6,168 | 6,168 | 2,685 | **2,119** |
| architecture-enforcer | 3,137 | 2,761 | 2,840 | 2,840 (see note) |
| **true total** | **27,159** | **17,645** | **14,243** | **13,680** |

Down 13,479 from the drive's start. The comment sweep has cleared **4,049 of
6,168, or 66%**, across eighteen areas.

**The enforcer number is not comparable to the 2,761.** Measured it prints
`2840 findings across 56 policies, exit 1 (2662 findings and 178 stale baseline
rows)`. The 2,761 never stated whether stale rows were counted, so the real
movement is either 99 down or 79 up. Whoever next touches the enforcer half
should restate the baseline in the form the tool actually prints and stop
carrying the ambiguous number forward.

### The sweep is not a ratchet, and this is now measured

Wave 4 cleared 578 findings and the tree fell by 566. The missing 12 are **new
findings that appeared while the wave ran**, in roughly an hour:

- 9 in files the other session has uncommitted — `packages/api/src/trpc/throttle.ts`
  (3, untracked), `packages/infrastructure/src/redis-members.ts` and its test,
  `packages/api/src/rest/declaration.ts`, `modules/auth/server/src/app/auth.app.ts`,
  `apps/api/src/app/api-production.composition.ts`;
- 3 in **committed** files under `modules/trace`, an area swept to zero in wave 1
  — `tracked-event.rest.declaration.unit.test.ts` (2) and
  `tracked-event-span.service.ts` (1).

The last three deserve care, because the obvious reading is wrong. Neither file
is a regression of swept code: `git cat-file -e` confirms **neither existed** at
the trace sweep commit `e2bbe50397`, and both were created afterwards by
`2722423f6f`. They are new code that arrived carrying over-budget comments.

That is the finding. Nothing stops new code from adding `comment-block-size`
findings, because the rule cannot gate anything while 10,840 findings already
fail it. So the drive is filling a bucket with a hole in it — small, currently
about a dozen an hour of concurrent work, but it means "reach zero" and "stay at
zero" are two jobs and only the first is planned. Whoever finishes the sweep
should land the gate in the same change, or the count starts climbing the day
after.

Typecheck held at its **114-error / 40-file** baseline throughout; verify
against that number, not zero, and compare the error-code distribution and the
erroring file set, not just the count.

## Decisions the user made — do NOT relitigate

1. **Target is every finding, not the CI gate.**
2. **`vitest/require-mock-type-parameters` is off** (ADR-142 amendment). 11,741
   findings, test-only, no possible codemod — the type argument has to be the
   mocked signature itself.
3. **Comment blocks keep the 5-line maximum, and the warning tier is gone.**
   The user rejected raising the max (to 8, then to 6) twice, with the reason:
   *"what comments need to be 5+ lines? if it's that important, ADR it."* So
   6+ lines now ERRORS. This converted 5,212 warnings into errors and is why
   the error count went up. `@lint-keep` had **zero** uses in the entire tree —
   the escape hatch ADR-140 built was never used once.
4. **Lint runs from the repository root** (`oxlint .`), not a path list. That
   list excluded 25 packages, including `plugins/langwatch` (a published plugin,
   1,331 findings) and `packages/oxlint-rules` — the linter's own rules.
   `**/*.generated.ts` is ignored, because the fix for a generated file is in
   its generator.
5. **Event sourcing is one folder** (ADR-137 amendment): 259 files out of
   `projections/`, `intents/`, `processes/`, `subscribers/`, `stores/eventing/`.

## Three traps that will cost you a day each

**A path-keyed baseline does not survive a rename, and fails silently.** The
registers in `packages/architecture-enforcer/src/*baseline.json` are keyed
`rule|path`. A row matching nothing says nothing — the rule re-reports accepted
debt as new. The eventing move appeared to add 208 findings across six rules;
all of it was 325 orphaned keys. After ANY move: re-key the rows, **re-sort**
(codepoint order — a rename reorders them), then verify row counts preserved,
zero duplicate keys, and each affected rule back to its prior count.

**Autofix is exhausted, and one tier is harmful.** `oxlint --fix` clears 0.
`--fix-suggestions` clears 129, of which 10 break tests: it rewrites
`const x = expect(p).rejects…` into `const x = await expect(p).rejects…` in 8
files that defer the await deliberately (one carries a comment saying so),
which hangs them. Do not re-run that tier without re-excluding those.

**The enforcer's 2.76 GiB is a parse cache whose `WeakRef` collects nothing.**
`new WeakRef(t)` adds `t` to the current job's kept-alive list and a lint run is
one synchronous job — measured 14,158 trees cached, 14,158 alive after two
forced GCs, 0 collected; one event-loop yield freed 1.9 GiB. Two fixes were
tried and REJECTED on measurement (a bounded LRU is straight time-for-memory; an
uncached whole-repo walk made it *worse* at 3.39 GiB because the other 54
policies refill the cache). The peak is the union of every tree anything parses,
so no single-policy fix moves it. The only real fix is walking the tree once.
Full numbers in `dev/docs/plans/lint-to-zero-2026-09-15.md`.

## The work, sliced into lanes

### Wave 1 — the comment sweep (6,168 findings, 3,585 files)

**Progress: 3,483 of 6,168 cleared — 56%.** 1,813 by the first five lanes,
136 by a correction to the rule itself (`@integration`, `@vitest-environment`
and `@regression` were counted as prose though no author can delete them), 765
by the second tranche and 769 by the third.

Areas now at zero: `sdks/typescript` 550, `modules/analytics` 408,
`modules/trace` 381, `modules/scenario` 279, `modules/gateway` 204,
`packages/eventing` 194, `modules/ops` 172, `modules/automation` 166,
`modules/identity` 163, `modules/model-provider` 156, `modules/prompt` 154,
`modules/coding-agent` 150, `dev` 144 of 147,
`enterprise/modules/governance` 121, `modules/auth` 117.

One lane per area, largest first:

| lane | paths | findings |
| --- | --- | ---: |
| `comments-sdk-typescript` | `sdks/typescript` | 550 |
| `comments-analytics` | `modules/analytics` | 408 |
| `comments-trace` | `modules/trace` | 381 |
| `comments-scenario` | `modules/scenario` | 279 |
| `comments-enterprise` | `enterprise/modules` | 209 |
| `comments-gateway` | `modules/gateway` | 208 |
| `comments-eventing-pkg` | `packages/eventing` | 200 |
| `comments-ops` | `modules/ops` | 176 |
| `comments-automation` | `modules/automation` | 174 |
| `comments-model-provider` | `modules/model-provider` | 169 |
| `comments-identity` | `modules/identity` | 166 |
| `comments-coding-agent` | `modules/coding-agent` | 159 |
| `comments-prompt` | `modules/prompt` | 154 |
| `comments-langy` | `modules/langy` | 123 |
| `comments-auth` | `modules/auth` | 120 |
| `comments-apps` | `apps/worker`, `apps/api`, `apps/ui` | 283 |
| `comments-tail` | the remaining 78 areas | 2,021 |

Split `comments-tail` by package when you get to it; do not give one lane 78
areas. **Lanes must not run `pnpm format`** — it rewrites ~1,300 unrelated files.

### Wave 2 — the fallible-naming family (2,103, one coherent job)

`fallible-result-naming` (1,346) + `no-try-prefix` (757). **Opus, high effort** —
this is not a rename. A `try*` or nullable-returning method renamed to `find*`
must **narrow its catch to the absence case**; a blanket catch behind a `find*`
name is a worse bug than the lint it silences. One lane per module, and the lane
must show the narrowed catch in its handoff, not just the rename.

### Wave 3 — layout and boundaries

- `feature-source-layout` 320 — **173 are `services/` subdirectories**; layout v0
  wants `services/<name>.service.ts` flat, no subdirectory, no qualifier.
- `package-boundaries` 394, `zod-object-composition` 403, `temporal-only` 415,
  `condition-shape` 543, `service-classes` ~301. **Sonnet, medium.**
- **Six crowded `eventing/` folders** (identity 24 files, experiment 18, trace
  17, scenario 17, governance 15, coding-agent 13, against a 12 budget). The
  grammar already supports the nested form
  `eventing/<pipeline>/<subject>.<kind>.ts` — see `feature-layout-policy.mjs`.
  Two pre-existing `crowded-folder` baseline rows were re-keyed, not dropped.

### Wave 4 — the newly-linted region (~2,884, previously invisible)

`plugins/langwatch` (1,331), `packages/clickhouse-client` (127),
`packages/ksuid` (120), `packages/oxlint-rules` (113), `skills/_tests` (84),
`packages/redaction` (83), `dev/` (274), and the rest. Nobody has ever linted
these. **Sonnet, medium**, one lane per package.

### Wave 5 — the enforcer's 2,761

Separate from oxlint and untouched this session. `unused-module-export` 373,
`boundary-signature-mirrors` 282, `api-transport-handler-shape` 247,
`api-transport-handler-boundary` 200, `private-runtime-export` 171. Also 178
stale baseline rows to clear. **Opus for the boundary policies, Sonnet for the
rest.**

## Process

- Lanes do not commit; the coordinator collects per-lane with **scoped**
  `git add`. Do not use `git add -A` at the repository root: it swept 29 files
  of a concurrent session's work into a commit this session, and unpicking it
  needed a soft reset.
- **Another session is live on this checkout** (haven TUI work in
  `tools/thuishaven`, plus ~46 dirty files from earlier drives). Leave them
  alone; `git stash list` has one entry that is not yours.
- `git stash` is banned in lanes. To compare against HEAD use
  `git show HEAD:<path>` into a temp file.
- Re-measure with
  `npx oxlint --config .oxlintrc.jsonc --format=json . > out.json` and count by
  `code` — do not trust `pnpm lint`'s own output for a total, it runs `--quiet`
  and hides every warning.

## Next action

Collect the six lanes in flight (roster in `.claude/coordinator/LANES.md`), then
slice the next tranche from a **fresh** whole-tree measurement — never from a
stale `.tsv`, because the rule's discount list changed mid-drive and the old
slices name findings that no longer exist.

Areas still untouched, largest first, from the measurement above:
`apps/worker` 110, `modules/organization` 108, `modules/langy` 105,
`modules/authz` 97, `modules/api-key` 86, `packages/architecture-enforcer` 85,
`apps/api` 82, `apps/ui` 81, `modules/dataset` 81, `modules/experiment` 77,
`packages/clickhouse-client` 77, `modules/workflow` 69, `packages/api` 68, then
a long tail.

### Fifty-three inert `biome-ignore` comments — a decision, not a task

Found while clearing `modules/prompt`'s last three findings. **Biome is not in
this toolchain**: no `biome.json` anywhere, no `@biomejs/biome` in any
`package.json`, no script invoking it. CLAUDE.md is right that oxlint and oxfmt
are the only JavaScript linter and formatter here.

So every `// biome-ignore lint/...` comment in the tree is read by no tool that
runs. There are **53** of them, concentrated in `modules/ops/server` (9),
`modules/analytics/web` (7), `modules/trace/web` (5) and
`enterprise/modules/governance` (5). Verified on the prompt file: oxlint reports
no empty-function finding there with or without the directive, and oxlint does
not parse `biome-ignore` syntax in any case.

They matter to this drive only where one is over 100 columns and so trips
`comment-block-size` itself. Three were; they were shortened to fit rather than
deleted, because **deleting 3 of 53 is a policy decision in disguise** and this
is the user's call, not a sweep lane's:

- **Delete all 53** — they assert a suppression no tool honours, and a reader
  reasonably believes a `biome-ignore` is load-bearing. Cheapest to reason about.
- **Keep them** — they document *why* a block is intentionally empty, which is
  real information even with the rule name attached to a dead linter.
- **Convert them** to the oxlint equivalent where the rule exists here, and
  delete the rest. Most work, most honest result.

Note that several sit on genuinely empty function bodies that oxlint does not
currently flag, so converting is not a mechanical rewrite — it needs a rule to
convert *to*, and for some there is not one.

### The mop-up nobody should forget

**Was 24 findings inside already-swept areas. Nine are now cleared** (`47f42c4ca7`),
leaving **15**, none a lane's work:

- **12 blocked behind another session's uncommitted files** — gateway 4,
  identity 3, auth 3, ops 1, model-provider 1. They cannot be swept while
  someone else is mid-edit in them; re-measure once that session commits.
- **3 the two `dev/scripts` headers**, below — a decision, not a task.

The nine that are gone were over-long comment *lines*, not oversized blocks, and
eight of the nine were `biome-ignore` directives. A directive cannot be wrapped
without breaking it, so the fix was to move each explanation to a prose line
above and leave a short reason on the directive — except where the directive sat
flush against a JSDoc close, since an inserted line merges into that block and
trades a column violation for a length one. Both shapes are in `47f42c4ca7` if
you need the pattern again.

**Measure residuals with an exact path boundary.** `startswith("modules/auth")`
also matches `modules/authz` and reports 100 findings where there are 3. Match
on `area + "/"`. This produced one wrong count in this drive already, and the
wave-4 manifest for `modules/langy` + `modules/authz` had to say so explicitly.

### The two `dev/scripts` headers — a decision, not a task

`dev/scripts/check-queue.mjs` (58 lines) and `dev/scripts/dev-supervisor.mjs`
(140 lines, plus a 132-column line). The `w3-dev` lane deliberately left both and
escalated, which was correct: these are not narration.

- `check-queue.mjs` documents the **environment contract** every agent in this
  repo passes through — `CHECK_SLOTS`, `CHECK_QUEUE_HELD`, `CHECK_PRESSURE`,
  including the rule that an agent shell may not gate the queue off. Much of it
  is restated in CLAUDE.md, and the script already has `--explain`.
- `dev-supervisor.mjs` carries a **PID table** showing an abandoned stack's
  process group. The table *is* the argument for why the supervisor exists;
  compressed to three lines it becomes an assertion nobody can check.

Neither belongs in a 5-line budget, and neither should be deleted. The options:
a `dev/docs/` page each with a one-line pointer (cheapest, keeps them readable);
an ADR for the supervisor's process-group design plus `--help` text for the
queue's environment contract (most correct, most work); or an explicit,
documented exemption. **This is a writing task, not a sweep task** — Fable's
band, once someone picks the destination.
