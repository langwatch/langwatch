# Architecture-lint review — 2026-09-03

**Audited:** 2026-09-03 against the working tree. Part A landed; Part B's
rule-by-rule table produced the R-slice list now carried by
`architecture-lint-burn-down-plan.md`. What is left here is the two decisions
the review deliberately did not take.

## Landed

- **Part A — the comment-block thresholds** (`793dcd22c4`).
  `src/comment-blocks.ts` now reads `REVIEW_LINE_COUNT = 4` and
  `MAX_COMMENT_BLOCK_LINES = 5`, with `isExemptBlock()` for lint-directive-only
  blocks and `@scenario` blocks. License and generated-file headers were
  already exempt at the whole-file level.
- **The two secondary gaps Part A flagged** were closed by R1 in the same
  commit: the warn tier prints on every `pnpm lint` run for changed files, and
  the whole-repo error tier is real behind `src/comment-block-roots.json`
  (root-keyed, shrink-only, with expiries).
- **R9's housekeeping** (`793dcd22c4`): `legacy-feature-fragment-baseline.json`
  is deleted.

The root cause Part A recorded is worth keeping because it is the reason the
rule looked wired and caught nothing: the thresholds were 30 (warn) and 60
(error), so the 8–23 line JSDoc paragraphs the composition roots are full of
never reached the queue. The rule *was* wired into `pnpm lint`, *did* scan
`apps/**`, and had no baseline swallowing anything — it was a threshold
problem alone.

## Open — two decisions the review declined to take

1. **Whole-repo warn visibility.** R1 made the warn tier visible for changed
   files only. Whether a 4–5 line block anywhere in the tree should be
   reportable on a normal `pnpm lint` (as opposed to
   `review:comment-blocks`) is still an open design call. Recommendation:
   leave it as it is — a 10,295-line listing on every run trains people to
   ignore the output.
2. **The two drained baselines.** `global-app-access-baseline.json` and
   `legacy-application-boundary-baseline.json` are both fully drained to zero
   and still present. `global-app-access` should stay as the deliberate
   tripwire its own file comment describes (its `ACCESSOR_FILE` names a path
   that no longer exists on purpose). `legacy-application-boundary`'s four edge
   buckets are empty and it costs nothing to keep, but the ratchet is doing no
   work; R9 lists replacing it with a flat check as optional and it was not
   attempted. See decision 2 in `open-decisions-2026-09-03.md`.

## Open — one follow-up the review could not finish

**Redundancy with oxlint.** `.oxlintrc.architecture.json` wires a separate
`langwatch/*` jsPlugin (`oxlint-plugin.mjs`) with rules named
`package-boundaries`, `feature-module-classes`, `service-classes`,
`service-dependencies`, `environment-boundaries`, `api-context-services`. Those
names overlap semantically with this package's `application-boundaries`,
`feature-layout` and `service-quality`. The review did not have budget to read
`oxlint-plugin.mjs` closely enough to say whether they check the same thing two
ways or split responsibility cleanly. §7 of the burn-down plan records the two
places where the overlap is name-only; the rest is still unread. Resume point:
read `oxlint-plugin.mjs`'s `service-quality` and `package-boundaries` bodies
side by side with `src/service-quality.ts` and `src/manifests.ts`.

## Still-true facts worth keeping

- **No baseline in this package is stale.** Every path-bearing baseline
  (`overengineering`, `port-module`, `service-quality`, `typed-prisma-seam`)
  resolves 100% of its entries to real files.
- **`pnpm lint` is not the same gate as `pnpm lint:declarations` or
  `pnpm lint:migration`.** The standard `lint` script passes
  `--no-declarations` and `--no-legacy-application-migration`. Intentional, but
  undocumented anywhere a new contributor would find it before assuming
  `pnpm lint` is the single source of truth — a one-line note in
  `package.json` or the package README is still owed.
- **`browser-packages.ts`'s vitest-only/lint split is deliberate**, per
  CLAUDE.md ("a linter can't replace the transitive test"), not a gap.
- **`frontend-ui-boundaries.ts` is the largest module in the package** (67 KB)
  and worth a future split-by-concern pass. Code quality, not a rule change.
