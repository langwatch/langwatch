# Architecture-lint review — 2026-09-03

Scope: `packages/architecture-lint`. Part A (comment-block enforcement bug) is
fixed in this change. Part B (rule-by-rule review) is report-only — nothing
described below as "stale" or "redundant" has been deleted.

## Part A — why oversized comments were not being caught

**Root cause: the thresholds in `src/comment-blocks.ts` were 30 lines (warn)
and 60 lines (error).** A 15-line docblock, or the many 8–23 line JSDoc
paragraphs in `apps/api/src/app/*.composition.ts` and
`apps/api/src/app-trpc/app-trpc.features.ts`, never got near either number, so
they never reached the review queue and never failed the gate. This was a
threshold problem, not a wiring problem — the rule *is* wired into `pnpm lint`
and *does* scan `apps/**`, contrary to the two most likely alternate
explanations:

- `src/comment-blocks.ts:8-9` (before fix): `REVIEW_LINE_COUNT = 30`,
  `MAX_COMMENT_BLOCK_LINES = 60`.
- `src/index.ts:143`: `lintWorkspace` splices `resolvedCommentBlocks.violations`
  straight into the violations array `pnpm lint` fails on — the error tier
  reaches the gate.
- `src/comment-blocks.ts` has no root restriction: `EXCLUDED_DIRECTORIES` is
  `.git, .next, .next-saas, build, coverage, dist, generated, node_modules,
  vendor` — `apps/` was already in scope.
- There is no baseline file for comment blocks (unlike overengineering,
  service-quality, etc.) swallowing anything.

Two secondary gaps, fixed alongside the threshold:

1. **The warn tier was invisible outside `--review-comment-blocks`.**
   `src/cli.ts` only prints `commentBlocks.reviews` under that flag, and the
   root `pnpm lint` script (`package.json` → `lint:architecture` →
   `packages/architecture-lint`'s own `lint` script) never passes it. So even
   a block that *did* clear the 30-line warn bar produced no visible output on
   a normal `pnpm lint` run — only `pnpm --filter @langwatch/architecture-lint
   review:comment-blocks` (not part of the standard toolchain) surfaced it.
2. **The default scan is `changedFiles` only.** `lintCommentBlocks`'s default
   `files` option is `changedSourceFiles(root)` — a git diff against the
   merge-base plus working-tree changes — not the whole repo. A long-standing
   docblock that hasn't been touched since it landed will never be flagged by
   a normal `pnpm lint`, only by `pnpm --filter @langwatch/architecture-lint
   review:comment-blocks` (which does pass `--all-comment-blocks`). This is
   the same trade-off the rest of the lint package makes deliberately
   (baselines are shrink-only against a merge-base) and is not itself a bug,
   but it means "how many violations exist repo-wide" and "how many will
   `pnpm lint` catch on your next PR" are different numbers — see below.

### The fix

`src/comment-blocks.ts`:

- `REVIEW_LINE_COUNT` 30 → 4 (a block of 4 or 5 lines warns).
- `MAX_COMMENT_BLOCK_LINES` 60 → 5 (a block of 6+ lines fails).
- Added `isExemptBlock()`: a block is exempt when every non-empty line is an
  `eslint-`, `oxlint-`, or `@ts-` directive, or when the block contains a
  `@scenario` annotation. License headers and generated-file headers were
  already exempted at the whole-file level (`marksLicenseHeader`,
  `marksGeneratedHeader`) and are untouched.
- The 3/5/6-line boundary, JSDoc counting, `@scenario` exemption, directive
  exemption, and `apps/` coverage are now asserted directly in
  `tests/comment-blocks.test.ts` (written first, then made to pass) and
  `tests/cli-comment-review.test.ts` (fixture sizes updated to the new
  boundary). Full package suite: 43 files / 578 tests, all green.

**I did not lower the CLI-visibility or changed-files-only gaps described
above** — that is a design call (do warnings belong in every `pnpm lint` run,
or only in a dedicated review pass?) that should be made deliberately, not as
a side effect of a comment-block fix. Flagging it here for a decision.

### Repo-wide count at the new thresholds

Running `lintCommentBlocks` unscoped (`--all-comment-blocks` equivalent)
against the whole repo:

- **WARN (4–5 lines): 10,295 blocks.**
- **ERROR (6+ lines): 20,138 blocks.**

This is the *whole-repo* number, not what a single `pnpm lint` run will
surface today (which only checks files in your diff — see gap 2 above). The
20 largest blocks, all at ERROR:

| Lines | File |
| ---: | --- |
| 112 | `sdks/typescript/src/observability-sdk/exporters/langwatch-trace-exporter.ts` |
| 77 | `apps/api/src/app/api-identity-pipelines.composition.ts` |
| 76 | `apps/api/src/app/api-trpc-collaborators.execution.composition.ts` |
| 76 | `sdks/typescript/src/observability-sdk/tracer/types.ts` |
| 74 | `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts` |
| 69 | `apps/api/src/app/api-scim.composition.ts` |
| 69 | `packages/features/analytics/server/src/langwatch-ql/validation/validate.ts` |
| 68 | `apps/api/src/app/api-trpc-collaborators.trace-group.composition.ts` |
| 66 | `apps/api/src/app/api-trpc-collaborators.org-group.composition.ts` |
| 66 | `dev/scripts/dev-supervisor.mjs` |
| 66 | `packages/features/langy/contract/src/cards/derived-safe.ts` |
| 64 | `apps/ui/src/features/chrome/index.ts` |
| 64 | `packages/prisma-client/prisma/seed.ts` |
| 63 | `apps/api/src/app/api-trpc-collaborators.identity.composition.ts` |
| 63 | `packages/features/analytics/server/src/langwatch-ql/validation/functions.ts` |
| 62 | `apps/api/src/app/api-trace-ingest.composition.ts` |
| 62 | `packages/features/ops/server/src/ops.system-migration-cohort.ts` |
| 60 | `apps/api/src/app/api-usage.composition.ts` |
| 60 | `packages/features/langy/contract/src/langy-permission-policy.ts` |
| 59 | `apps/ui/src/features/chrome/ui/sections/ui-app-chrome.tsx` |

Not rewritten, per instructions — this is a report, and 20,138 blocks is a
sweep-scale cleanup, not a one-shot fix. Two of the highest-signal offenders
worth flagging by name: `global-app-access.ts`'s own tripwire comment (6
lines, ERROR under the new rule) and `browser-packages.ts`'s file header (21
lines) — both are deliberate, load-bearing explanations for *why a rule
exists*, not incidental prose, and are exactly the kind of block that needs a
human "does this still earn its length" pass rather than a mechanical trim.

## Part B — rule-by-rule review

### How `cli.ts` dispatches

```
pnpm lint (root)
   -> lint:architecture
        -> lint:oxlint  (separate tool: oxc built-ins + langwatch/* oxlint-plugin.mjs rules)
        -> architecture-lint's own "lint" script:
             tsx src/cli.ts --root ../.. --no-declarations --no-legacy-application-migration
                 |
                 v
        +-------------------------------------------------------+
        |  cli.ts                                                |
        |    changedFiles = changedSourceFiles(root)  (git diff)  |
        |    commentBlocks = lintCommentBlocks(root, {changedFiles})
        |                                                         |
        |    if --shrinking-baseline-only / --service-quality-... |
        |         -> baseline-only checks (service-quality,       |
        |            strict-ports) against a --baseline-reference-dir
        |    elif --review-comment-blocks    -> commentBlocks.violations only, prints reviews to stdout
        |    elif --review-test-quality      -> lintTestQuality only
        |    else                            -> lintWorkspace(...)  <- the normal `pnpm lint` path
        +-------------------------------------------------------+
                 |
                 v
        lintWorkspace (index.ts) — one discoverClassifiedPackages() call, then
        concatenates violations from every rule below, relativizes paths,
        sorts, returns. exitCode=1 if non-empty.
             |
             +-- lintFeatureLayouts          +-- lintApiTransportBoundaries
             +-- lintFrontendUiBoundaries     +-- lintPrismaBoundaries
             +-- lintGlobalAppAccess          +-- lintTypedPrismaSeam
             +-- lintLegacyFeatureFragments   +-- lintServiceResultContracts
             +-- lintEventingRoles            +-- lintServiceProjectionBoundaries
             +-- lintArchitectureRecords      +-- lintServiceQuality
             +-- lintStrictContractBuildConfigs +-- lintCycles
             +-- lintStrictPortModules        +-- resolvedCommentBlocks.violations
             +-- lintManifests                +-- lintTestQuality(changedFiles)
             +-- lintOverengineering          +-- lintDeclarations (unless --no-declarations)
             +-- lintApplicationBoundaries
```

Three scripts run *outside* this dispatch entirely, each with its own CLI
entry point, and are not "lint rules" in the `pnpm lint` sense — they are
codemods / one-off checks a person runs by name:

- `colocate-tests` → `src/colocate-tests.cli.ts` → `src/test-colocation.ts`
- `rename-feature-sources` → `src/rename-feature-sources.cli.ts` →
  `src/filename-migration.ts`
- `rename-package` → `src/rename-workspace-package.cli.ts` →
  `src/workspace-package-rename.ts`
- `check:feature-parity` → `src/check-feature-parity.ts` (its own script,
  reads `.feature` tags; not part of `pnpm lint`)

### Table

| Rule | Enforces | Runs from `pnpm lint`? | Baseline (entries / stale) | Redundant with | Message actionable? | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| api-transport-boundaries | REST/tRPC transport code stays inside its owning feature's transport layer, doesn't leak transport types across features | Yes | none | — | Yes | Keep |
| application-boundaries | Legacy app-to-app import edges (backend↔browser, ee-alias, enterprise↔application) stay within a shrink-only baseline | Yes (`--no-legacy-application-migration` disables in the standard `lint` script) | `legacy-application-boundary-baseline.json` — 0 entries, i.e. fully drained | — | Yes | Tighten: baseline is empty across all four edge kinds; consider replacing the baseline machinery with a flat zero-tolerance check now that migration is done, or delete the baseline file if the rule can hard-fail unconditionally |
| architecture-records | Every classified package that needs one has a matching ADR reference | Yes | none | — | Yes | Keep |
| browser-packages | Not a standalone rule — shared constant list (`BROWSER_ONLY_PACKAGES`) consumed by `frontend-ui-boundaries.ts` (in `pnpm lint`) and separately by `tests/frontend-boundary.unit.test.ts` (vitest-only, never from `pnpm lint`) | Partially — the list itself has no independent gate; one consumer is in `pnpm lint`, the other (the transitive memory-footprint walk from server entrypoints) is `pnpm test`-only | none | — | N/A (shared data, not a rule) | Keep as is — this vitest-only/lint split is intentional per CLAUDE.md ("a linter can't replace the transitive test"), not a gap |
| colocate-tests | Moves a feature's `tests/` tree into `__tests__` beside the code it covers | No — own CLI (`pnpm colocate-tests`), a one-shot codemod, not a lint gate | none | — | N/A | Keep as a tool; don't expect it in `pnpm lint` |
| contract-build-config | Contract packages ship a consistent build config (tsup/tsconfig shape) | Yes | none | — | Yes | Keep |
| cycles | No import cycles between classified packages | Yes | none | — | Yes | Keep |
| declarations | Every package emits `.d.ts` correctly / declares its types entry | Yes, unless `--no-declarations` (the standard `lint` script passes it — so declarations do NOT run in the everyday `pnpm lint`, only `lint:declarations`) | none | tsc itself partly | Yes | Keep, but note it: the default `pnpm lint` silently skips this rule; only `pnpm lint:architecture:declarations` runs it. Not a bug (documented via the flag name) but worth a comment where `--no-declarations` is passed in `package.json`'s `lint` script, since it's easy to assume `pnpm lint` covers it |
| eventing-roles | Producer/consumer roles for the eventing system match declared package roles | Yes | none | — | Yes | Keep |
| feature-catalogue | Not a rule — parses/validates `catalogue.json` shape (name ordering, uniqueness) and feeds `discoverClassifiedPackages`, which every other rule depends on | Indirectly, via every rule | none | — | N/A (infra) | Keep |
| feature-layout | Strict feature-source layout: `services/` takes only `.service.ts`, `ports/` needs an abstract `Port` class, etc. (per `strict-feature-source-layout-grammar` memory) | Yes | none | — | Yes | Keep — actively being tightened by a concurrent agent on `lintPrivateServerExports`; do not touch |
| filename-migration | Codemod: plans/applies file renames for a migration | No — used only by `rename-feature-sources.cli.ts` | none | — | N/A | Keep as a tool |
| frontend-ui-boundaries | Browser-only packages/JSX don't leak into server code; portable-shared modules stay framework-free (the "2,020 modules" incident this file exists to prevent) | Yes | none | — | Yes | Keep — largest module in the package (67KB); worth a future split-by-concern pass, but that's a code-quality call, not a "delete/merge" one |
| global-app-access | Forbids importing the deleted `platform/app` global accessor (`getApp`/`tryGetApp`) by file path or the `~/server/app-layer/app` alias, so the pattern can't quietly return | Yes | `global-app-access-baseline.json` — 0 entries, fully drained | — | Yes | Keep — the ACCESSOR_FILE constant intentionally names a path that no longer exists (`platform/app/src/server/app-layer/app.ts`); this is documented in the file's own comment as a deliberate tripwire, not stale code. (That comment is itself 6 lines and will now trip Part A's own ERROR threshold — a good illustration that "over 5 lines" catches legitimate explanations too, which is why the rule warns/errors rather than deletes.) |
| legacy-application-boundary | See "application-boundaries" above (same module) | — | — | — | — | (duplicate row for the name given in the prompt; module is `application-boundaries.ts`) |
| legacy-feature-fragments | Fragments of feature code left outside their owning package during the extraction stay within a shrink-only baseline | Yes, unless `--no-legacy-feature-fragments` (the standard `lint` script does NOT pass that flag, so this one is active in normal `pnpm lint`) | `legacy-feature-fragment-baseline.json` — 0 entries, fully drained | — | Yes | Tighten: baseline is empty; same call as application-boundaries — either flatten to zero-tolerance or drop the baseline machinery |
| manifests | Package `package.json`/manifest shape matches its classified kind (exports, files, etc.) | Yes | none | — | Yes | Keep |
| overengineering | Flags identity functions, single-implementation ports, pass-through layers, and deep conditional types, matching the `overengineering-audit` skill's mechanical detectors | Yes | `overengineering-baseline.json` — 4 entries, 0 stale (all 4 target files exist) | Conceptually overlaps with the `overengineering-audit` skill's manual pass, but that skill explicitly runs this rule's detectors first and then reads what they can't see — complementary, not redundant | Yes | Keep |
| port-modules | "Strict port" packages declare an abstract `Port` class per the service-repository-adapter-port pattern | Yes | `port-module-baseline.json` — 28 entries, 0 stale | Overlaps in spirit with `feature-layout`'s "ports/ needs an abstract Port class" check — worth confirming the two don't double-count the same violation on a bad file | Yes | Keep; verify no double-reporting with feature-layout |
| prisma-boundaries | Only `repositories/prisma/**` and `adapters/postgres.*.adapter.ts` may import `PrismaClient` | Yes | none | Complements `typed-prisma-seam` (the untyped-cast half of the same seam rule) — not redundant, two halves of one contract | Yes | Keep |
| service-quality | Service files stay under complexity/length/statement ceilings, ratcheted via a shrink-only baseline | Yes | `service-quality-baseline.json` — 15 entries, 0 stale | — | Yes | Keep |
| typed-prisma-seam | No untyped `PrismaClient` cast reintroduced outside the allowed seam files, ratcheted via a shrink-only baseline | Yes | `typed-prisma-seam-baseline.json` — 47 entries, 0 stale | Complements `prisma-boundaries` (see above) | Yes | Keep |
| comment-blocks | Oversized comment blocks (see Part A) | Yes (error tier); warn tier invisible outside `--review-comment-blocks` | none | — | Yes | Fixed in this change (thresholds); CLI-visibility and changed-files-only scope gaps flagged above for a decision |

### Cross-cutting findings

- **No baseline in this package is more than 0% stale.** Every path-bearing
  baseline (`overengineering`, `port-module`, `service-quality`,
  `typed-prisma-seam`) resolves 100% of its entries to real files. The
  shrink-only ratchet design (CLAUDE.md's "future merge-base checks can only
  shrink it") is working as intended — this is a healthy finding, not a gap.
- **Three baselines are fully drained to zero** (`global-app-access`,
  `legacy-application-boundary`, `legacy-feature-fragment`). Each still has a
  README-worthy purpose (documented tripwires / migration trackers) but is no
  longer doing ratchet work since there's nothing left to shrink. Worth a
  deliberate decision — keep as permanent tripwires (my read: yes for
  `global-app-access`, since it guards against reintroducing a deleted
  pattern by name) vs. simplify to a flat assertion now that the migration
  finished.
- **`--no-declarations` and default flags mean `pnpm lint` is not the same
  gate as `pnpm lint:declarations` or `pnpm lint:migration`.** This is
  intentional (declaration checks and legacy-application-migration checks are
  expensive/noisy day-to-day) but isn't documented anywhere a new contributor
  would find it before assuming `pnpm lint` is the single source of truth.
  Worth a one-line note in `package.json` or this package's own README.
- **No rule in this package references a deleted `platform/app` path as if it
  were still live** — the one `platform/app` string still present
  (`global-app-access.ts`) is a documented, deliberate tripwire against
  reintroduction, not stale code. `frontend-ui-boundaries.ts` also names
  "legacy platform/app implementation" four times, but only as a *message
  string* describing why a match failed, not as a path it resolves.
- **Redundancy with oxlint:** `.oxlintrc.architecture.json` wires a separate
  `langwatch/*` jsPlugin (`oxlint-plugin.mjs`) with rules named
  `package-boundaries`, `feature-module-classes`, `service-classes`,
  `service-dependencies`, `environment-boundaries`, `api-context-services`.
  These names overlap semantically with this package's
  `application-boundaries`, `feature-layout`, and `service-quality` rules. I
  did not have budget in this pass to read `oxlint-plugin.mjs` closely enough
  to say whether they check the same thing two ways or split responsibility
  cleanly — flagging as a follow-up worth a dedicated look, not asserting
  redundancy.
