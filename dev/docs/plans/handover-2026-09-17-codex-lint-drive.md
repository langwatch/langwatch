# Handover — codex lint drive, 2026-09-17

## Next action

Read the measurement section below **before quoting any lint number**, then
collect round four (lanes P, Q, S, U, V) if it is still uncollected.

## The measurement was broken for the whole drive, and is now fixed

`oxlint` exits without flushing stdout, so **piping it truncates the output**.
Three identical piped runs of one tree returned **3,712 / 4,646 / 7,956**
findings. Redirected to a file the same tree returns **8,176** three times,
byte-identical. The giveaway is output ending mid-sentence.

Every lint figure quoted on this drive before 2026-09-17 — including
"11,065 → 9,052" — was piped, and is noise. Do not compare against them.

```bash
# the only correct form
pnpm exec oxlint --quiet --config .oxlintrc.jsonc . > /tmp/lint.txt 2>&1
grep -cE '^[a-zA-Z0-9_./@-]+\.(ts|tsx|mjs|js|cjs|mts)[^ ]*:[0-9]+:[0-9]+: error' /tmp/lint.txt
```

Three adjacent traps, each of which produced a confident wrong answer today:

- **`grep -cE 'error TS'` on tsc output always returns 0.** tsc colourises, so
  the bytes are `error<ESC>[0m<ESC>[90m TS2307:` and the literal string never
  appears. Strip first with `sed -E 's/\x1b\[[0-9;]*m//g'`, then match
  `' - error TS[0-9]+:'`.
- **`tsc -b` is incremental**: a repeat run prints nothing and still exits 1.
  Empty output is not zero errors — check the exit code. And `tsc -b --force` on
  one package floods **TS6305**, a build-order artifact, not real errors.
- **`$?` after a pipeline is the last command's status**, not the check's.

**Baselining a commit** needs a worktree with its own install — linting a
worktree from outside the repo root silently disables every path-scoped
langwatch rule (`temporal-only` and friends match `^(apps|modules|enterprise)/`
against the workspace-relative path) and undercounts by roughly 2,000:

```bash
git worktree add --detach /tmp/base <ref> && cd /tmp/base && pnpm install
./node_modules/.bin/oxlint --quiet --config .oxlintrc.jsonc . > /tmp/base.txt 2>&1
```

Always run a **control**: scopes no lane touched must return identical counts on
both sides. Five of six did on every round below, which is what makes these
deltas measurements rather than impressions.

## Where the number is

| point | total | commit |
| ----- | ----- | ------ |
| baseline | 8,441 | `2c14c74d0a` |
| after round 1 | 8,176 | `0cabffe042` |
| after round 2 | 8,084 | `47ad3c4e22` |
| after round 3 | 7,978 | `7746a2176f` |
| after round 4 | 7,761 | `a0d6968924` |
| after round 5 | 7,668 | `cac7754edb` |
| after round 6 | 7,564 | `01be84428a` |
| HostApi rename | 7,533 | `3b8be1ea32` |
| after round 7 | 7,394 | `273e60a76a` |
| round 8 + coordinator work | 7,244 | `8dc62e6c13` |

Round 4 was the largest at −217: the published SDK gave up 71 with its export
list byte-identical, trace 61, enterprise 64.

Rounds 2, 3 and 4 all carried the corrected measurement protocol and **every
lane's self-reported delta reproduced exactly** on independent re-measurement,
with every control scope at +0.

Rounds 2 and 3 carried the corrected measurement protocol in the lane briefs,
and **every lane's self-reported scope delta reproduced exactly** on independent
re-measurement. Round 1 did not, and one lane there reported −7 while netting +1.

## The vitest-config sweep, and why two lanes called it unfixable

Sixty-five packages had `vitest.config.ts` importing
`"../../../packages/test-harness/src/vitest-config.ts"`. Two lanes reported it as
a rule defect — *"cannot resolve `@langwatch/test-harness` unless package deps or
install state outside the linted source are changed"*. That is true of a **lane's
scope**, not of the finding: the fix needs a devDependency and a regenerated
lockfile, and lanes are told the lockfile is the coordinator's. Done in
`2023781468` for 61 of them (4 were inside running lanes' scopes).

**If a lane reports a finding as unfixable, check whether it is unfixable or
merely outside that lane's permissions.** This one was worth 101 findings.

It nearly got reverted: `modules/dataset` went 2 → 3 failing test files after the
change. Three runs each way gave 3/2/2 against 1/2/1 — the suite has a
pre-existing mock leak and both spellings sit inside its noise. What settles it is
that `@langwatch/test-harness/vitest-config` and the relative path resolve to the
**byte-identical absolute path**, so `import.meta.url` and the console-guard setup
it derives are unchanged. Verify the mechanism, not the flaky count.

## The three decisions a lane cannot take

1. **`apps/worker` — 982 findings, OWNER IS DESIGNING THE FIX (2026-09-17).**
   The constraints are written up in
   `dev/docs/plans/worker-module-app-decision.md`, including the verified reason:
   `TraceApp.dependencies` names thirteen peer modules, so the worker cannot call
   one `TraceApi` operation without installing trace and those thirteen. **Do not
   scope another lane at these findings.** Original notes follow. 780 are
   `module-app-only-across-packages`: the worker importing a module's server
   internals instead of calling its contract. Three lanes have now tried, netting
   +1, −20 and −1. The third owned `apps/worker` **and** `modules/trace` together
   with explicit permission to extend `TraceApi`, and still moved the worker by
   one. Its diagnosis: the worker's processing queues are unconditional, while
   installing `TraceApi` requires the full observability graph — so the worker
   cannot install the module whose operations it needs without acquiring a graph
   it has no reason to hold. Pairing scopes was not the missing permission. This
   is an architectural decision about `apps/worker`, and until it is taken these
   findings are not lint debt, they are a design question wearing lint clothing.

2. **RESOLVED 2026-09-17 in `3b8be1ea32`** — renamed repo-wide to `*HostApi`,
   matching `modules/annotation`, which had exported `abstract class
   AnnotationHostApi` all along; the guide was stale against its own reference
   module. `*Host` was not available: eight of nine modules already have a
   `<Name>Host` React component in `apps/ui` implementing the declaration.
   87 identifiers across 42 files, plus web.md, install.md and four module-skill
   references. `no-port-vocabulary` 170 → 141. Original notes follow.

   **`no-port-vocabulary` versus the architecture guide, 29 findings.** The rule
   bans PascalCase `*Port`. `references/web.md` *prescribes* `*HostPort` by name
   in four places (lines 13, 84, 87, 93): a screen declares what it needs as an
   abstract `*HostPort` class in `model/<f>-host.ts`, with `<F>HostProvider`,
   `use<F>Host()` and `Stub<F>Host extends <F>HostPort` in `testing.tsx`. All 29
   findings are in exactly those files. No ADR mentions the naming either way, and
   the rule's suggested fixes — repository, channel, member, service — do not
   exist in a web package, so its advice is unactionable there. Either exempt the
   web host-port pattern, or rename the concept repo-wide and update the guide.
   A lane must not decide this.

3. **The parked findings — OWNER RULED 2026-09-17: keep parked and visible.**
   No change; every brief continues to exclude them. Original notes follow.

   **The 1,244 parked findings.** `fallible-result-naming` (796) and
   `no-try-prefix` (448) are excluded from every brief on the owner's ruling,
   because converting a nullable `find*` changes behaviour at every call site that
   branches on absence. They are 16% of the meter. Convert, turn off by name with
   the reasoning recorded, or keep as visible debt — but while they stand, the
   total overstates what is actually left to do.

## Three more rule reports from round 4, unverified but worth reading

- **`banned-test-model-names` on a pricing fixture.**
  `modules/trace/server/src/services/__tests__/trace-span-cost-matching.audio.unit.test.ts:103`
  uses `gpt-4o` as the *subject* of a span-cost matching test. The historical
  model name is the fixture; substituting `gpt-5-mini` invalidates the pricing
  the test exists to check. The rule needs an exemption for cost/pricing tables.
- **`no-alias-reexport` on a published index.** `sdks/typescript/src/index.ts:23`
  — in a published package the alias *is* the export name users import, so the
  rule is asking for a breaking change.
- **`service-classes` on two Copilot Studio pullers.**
  `enterprise/modules/governance/server/src/services/copilot-studio-puller.service.ts:74`
  and `copilot-studio-dataverse-puller.service.ts:226`. The lane argued renaming
  to `*Service` misstates them. Probably both are wrong: a puller reaching a
  vendor over HTTP is a **channel**, not a service and not an adapter.

## Two rule-message defects, both confirmed twice

- **`feature-source-filename` reads as though an artifact suffix is mandatory.**
  It says *"Rename the file to `<subject>.<artifact>.ts` … picking one artifact
  from adapter, api, app, channel, …"* — twenty server artifacts, none of which
  fits a React hook. The grammar
  (`packages/oxlint-rules/grammar/feature-layout-policy.mjs`) makes the suffix
  **optional**: a single-part lower-kebab name passes. So `useDraggableGraphCard.ts`
  is correctly `use-draggable-graph-card.ts`, and the reference module agrees
  (`modules/annotation/web/src/behavior/use-annotation-period.ts`). A lane
  independently reported the same defect. The rule is right; its message will send
  an agent to invent `draggable-graph-card.service.ts`.

- **RESOLVED in round 4.** **`namespace-class` versus `feature-module-classes` is NOT unsatisfiable**,
  though a lane reported it as such. 13 files carry both, every one a
  static-method `*Adapter` in `repositories/clickhouse/`. `namespace-class` fires
  because all members are static; `feature-module-classes` wants a concrete
  `*Repository` class. Giving each a private constructor via `static create(...)`
  and instance methods satisfies both. A 26-finding slice with a repeatable shape.
  (The lane's *other* claim — that `namespace-class` pushes effectful clock and
  ingestion logic into a `rules/` folder the layout requires to be pure — has not
  been verified and may be real.)

## What the lanes are and how they are run

Codex CLI only, five at a time, path-exclusive so two lanes can never touch one
file. The owner's standing instruction is "no more sub agents here, codex only".

```bash
codex exec -m <model> --sandbox workspace-write \
  -c model_reasoning_effort="high|medium" "$(cat brief.txt)" < /dev/null
```

`< /dev/null` is required — a lane launched without it stalls on stdin and never
reaches its banner. Models in use: `gpt-6-astra`, `gpt-5.6-luna`, `gpt-5.6-sol`,
`gpt-5.6-terra`, `gpt-5.5`. Route the hardest architectural scope to astra, the
mechanical tail to 5.5.

Shared rules live in the job's `lanes/RULES.md` and are appended to every brief:
scope discipline, the ban on `git stash`, no casts or suppressions, the two
parked families, the measurement protocol, and the requirement to report the
**net over the whole scope** rather than the gross over files touched.

**Attribution:** snapshot `git status` before launching and subtract it. Several
sessions share this checkout and commit as the same git user, so a dirty file is
not evidence of ownership. Scope selection also excludes any area carrying
another session's uncommitted work.

**Collection checks that have each caught something real:** net cast delta
(count `+` *and* `-` lines — a rename inside an existing cast reads as an
addition), suppression comments, `git stash list` unchanged, manifest changes
(three lanes needed a dependency declared, and the lockfile is the coordinator's
file — `pnpm install` before committing or a clean install fails), and deletions
verified unreferenced before accepting them.

## Standing constraints

- ~1,217 existing nullable `find*` methods stay as they are — owner's ruling.
- No suppression lists, no baseline edits, no per-path overrides. There is no
  suppression ledger in this repository and none may be created.
- `pnpm format` rewrites ~1,300 unrelated files. Format only what you touched.
- Lanes may not edit rule sources or the grammar. They report defects; the
  coordinator acts on them.
