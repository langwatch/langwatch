# Handover: the lint-to-zero drive — 2026-09-16

**ENTRY POINT for the successor coordinator.** Read this, then
`.claude/coordinator/LANES.md` for roster conventions. Every number here was
measured this session, not inherited. Branch `feat/strict-feature-layout-v0`.

## The goal, as the user set it

**Every finding to zero.** Not the CI gate, not errors only — zero. Both halves
of `pnpm lint` count: `lint:oxlint` **and** `architecture-enforcer lint`.

## Scoreboard

| | drive start | handover written | now |
| --- | ---: | ---: | ---: |
| oxlint errors | 6,075 | 13,253 | 10,540 |
| oxlint warnings | 17,947 | 1,631 | 1,632 |
| oxlint total | 24,022 | 14,884 | **12,172** |
| — of which `comment-block-size` | 6,168 | 6,168 | **3,454** |
| architecture-enforcer | 3,137 | 2,761 | 2,840 (see note) |
| **true total** | **27,159** | **17,645** | **15,012** |

Down 12,147 from the drive's start, 2,633 of it in this session.

**The enforcer number is not comparable to the 2,761.** Measured now it prints
`2840 findings across 56 policies, exit 1 (2662 findings and 178 stale baseline
rows)`. The 2,761 never stated whether stale rows were counted, so the real
movement is either 99 down or 79 up. Whoever next touches the enforcer half
should restate the baseline in the form the tool actually prints and stop
carrying the ambiguous number forward.

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

**Progress: 2,714 of 6,168 cleared.** 1,813 by the first five lanes, 136 by a
correction to the rule itself (`@integration`, `@vitest-environment` and
`@regression` were being counted as prose though no author can delete them),
and 765 by the second tranche.

Collected so far: `sdks/typescript` 550, `modules/analytics` 408,
`modules/trace` 381, `modules/scenario` 279, `modules/gateway` 204,
`packages/eventing` 174 of 194 (partial), `modules/ops` 172,
`modules/identity` 163, `modules/model-provider` 156.


The bulk of the remaining total. **Sonnet, medium effort, standard context** —
mechanical per block, but each needs judgement about what may be lost.

The budget is 5 lines **including** `/**` and `*/`, so **3 content lines, about
230 characters**. Blocks average nearer 300, so this is not tightening; it is
deciding what to drop, or moving the narrative to an ADR and leaving one line
pointing at it (the user's stated preference — prefer the ADR for anything that
is genuinely load-bearing).

A worked example of the method is commit `91c5a9382e`
(`apps/ui/e2e/langy/local-control-fixture.ts`, 11 blocks). **Expect two passes:**
a draft written to "about five lines" lands on six every time. Lane closes only
when `oxlint --config .oxlintrc.jsonc <paths>` reports zero `comment-block-size`
for its own paths.

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

### The mop-up nobody should forget

18 `comment-block-size` findings remain inside areas already swept and reported
clean. They are not regressions, and they break down three ways:

- **8 are inside files another session has dirty** (`gateway-composition.build.ts`,
  `gateway-platform.rest.ts`, `ops-clickhouse-explain.rest.ts`,
  `join-request-notifier.service.ts`,
  `join-request-lifecycle-dispatcher.service.unit.test.ts`,
  `model-provider-evidence-service.composition.ts`). Every lane correctly
  skipped them. They can only be cut once that session's work lands.
- **9 are over-long comment *lines*, not blocks** — 100-column violations
  reported under the same rule id, in `modules/analytics/web` (6) and
  `sdks/typescript` (3). Most are `biome-ignore` / `eslint-disable` directives,
  which cannot simply be wrapped: the fix is the one-line relocation used in
  commit `095936beea`.
- **1 is a genuinely new block** in
  `modules/gateway/server/src/repositories/prisma/prisma.gateway-organization-directory.repository.ts`,
  in a clean file, written after the gateway sweep ran.

That last one is the useful signal: **the sweep is not a ratchet.** Nothing stops
a new over-budget block landing in a swept area, and one already has. Zero will
not stay zero on its own.
