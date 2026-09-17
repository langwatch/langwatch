# Plan — one rule, one place, one honest number (2026-09-17)

> **STATUS, end of 2026-09-17 — most of this plan has shipped.** Read this
> section before quoting anything below it: several measurements in the body
> were superseded the same day, and two recommendations were reversed by
> evidence.
>
> ### Shipped
>
> | change | result |
> | --- | --- |
> | Debt register deleted, 7 per-file exemptions deleted, `correctness` promoted to error | the gate went from **6,569** concealed to an honest count |
> | `node/no-process-env`, `import` (7 rules), `promise` (3), `jsx-a11y` (12), `unicorn/no-array-sort`, `import/no-duplicates`, `reportUnusedDisableDirectives` | **+4,184**, including **50 real import cycles** nothing had ever checked |
> | `oxlint-tsgolint` installed, `--type-aware` wired into `lint:oxlint` | **+2,225** across the 14 rules that were registered but inert; `no-floating-promises` is **334**, not the 39 the old register recorded. Costs 58s → **3m57s** |
> | oxfmt `sortImports` + `sortPackageJson` | enabled |
> | `-f github` | added as `lint:oxlint:ci`, restoring inline PR annotations |
> | 6 duplicate ast-grep rules deleted | they duplicated 3 oxlint plugin rules with narrower path coverage |
> | dead baseline machinery deleted | `overengineering.mjs` read a file that did not exist; CI fetched 3 deleted baselines |
> | `declarations.ts` reads built `.d.ts` | **>6m22s / 3.1 GB (killed unfinished) → 3.7s / 226 MB**, and it now actually runs. Found **310 real leaks** |
> | every traversal routed through the shared snapshot | 13 `createSourceFile`, 22 `walkFiles`, 5 private resolvers; new `workspace-seams` policy prevents regression |
>
> ### Reversed by evidence — do NOT follow the body on these
>
> - **§6 "Do not move the enforcer to TypeScript 7 *yet*" understates it: TS7 is
>   a regression, not a deferral.** Measured like-for-like over 8,280 files, TS7
>   is **3.8x slower** (37.2s vs 9.9s) because it has **no in-process parser at
>   all** — only Go, out-of-process — and re-reading an already-fetched file
>   costs 6.8s per pass where TS6 costs nothing. Worse, `createPrinter`,
>   `preProcessFile`, `parseJsonText` and `node.getChildren()` have **no TS7
>   equivalent**. The `typescript: ^6.0.3` pin is correct and should stay.
> - **§6's "81s → 5–8s" for the snapshot work was wrong.** The real gain is
>   **~7% CPU** (32.6s → 30.3s). A profile shows ~26s of the ~32s is
>   irreducible first-parse for ~15,000 files; the stray sites were worth ~8s,
>   not 70. Lane L3's "under 10s" target was never reachable in TS6.
> - **§9's claim that the check-queue shims are missing by accident is wrong.**
>   Root `postinstall` runs `install-check-shims.mjs --remove` deliberately.
>
> ### Discovered while shipping
>
> - **The ES2023 lib bump.** `unicorn/no-array-sort`'s fix is `.toSorted()`,
>   which needs ES2023. `tsconfig.base.json` targeted es2022 and 165 package
>   configs pinned `lib: ["es2022"]`, so the autofix broke ~310 files. Fixed by
>   raising everything below es2023 (`engines.node` is `>=24`; these methods
>   shipped in Node 20). `sdks/typescript` keeps `target: es2017` for
>   conservative emit and gained `lib: ["es2023"]` — target governs emit, lib
>   describes the runtime.
> - **`.sort()` → `.toSorted()` is a semantic change.** `.sort()` mutates and
>   returns the same array; `.toSorted()` returns a copy. Where the result is
>   discarded, the rewrite makes the line a **no-op**. oxlint's own fixer is
>   conservative and never did this, but a hand-fixing agent will. Check for it.
> - **A lint fix that changes behaviour is a bug, not a fix.** One agent
>   "fixed" `no-control-regex` by deleting `\x1b` from an ANSI-stripping
>   regex, leaving a pattern that ate `[I` out of `[INFO]`. The correct fix
>   builds the regex from `String.fromCharCode(27)`.
> - **`pnpm add -w` deletes every comment in `pnpm-workspace.yaml`** (288 lines
>   lost and restored). A concurrent `pnpm install` also empties
>   `node_modules/.bin` repo-wide, so a lint run writes an EMPTY file that
>   counts as "zero findings".
> - **ADR-149** now records the timestamp field convention (`createdAt` ISO,
>   `createdAtMs`, `createdAtUnix` seconds, `createdAtNano`) and explains why
>   its lint rule cannot ship yet: 672 numeric `*At` fields, 227 of them on the
>   wire where a rename is a breaking API change.
>
> ### Where the number is
>
> | point | errors |
> | --- | --- |
> | what CI blocked on before | 6,569 |
> | no baseline, no exemptions, correctness at error | 10,258 |
> | + every rule added today | 14,442 |
> | + type-aware | 16,642 |
> | after the auto-fix sweep and the first mechanical lanes | **12,142** (+2,225 type-aware) |
>
> The remaining work is overwhelmingly hand edits: only **2.5%** of the tree's
> findings were machine-fixable (253 of 10,208, measured across all three fix
> tiers).

Measured on `feat/strict-feature-layout-v0`, oxlint `1.78.0`, oxfmt `0.63.0`,
root `typescript@7.0.2`, enforcer `typescript@6.0.3`. Every number below was
produced by a command whose output was **redirected to a file**, never piped —
see "How to measure" at the bottom before quoting any of them.

Decisions taken by the user, 2026-09-17, and assumed throughout:

- **No baselines. No exemptions. Anything above zero is bad.**
- **Turn it all on now and fix under red CI.** The meter is honest from the
  first commit; `main` stays red until the drive lands.
- The 2,072-file format backlog is handled **separately, by the user**. It is
  recorded here only because `pnpm format:check` is a blocking CI step and will
  stay red until then.

## 1. The number

| configuration | errors |
| --- | --- |
| what CI blocks on today | **6,569** |
| the debt register deleted | 7,491 |
| register deleted **and** per-file exemptions removed **and** `correctness` at error | **10,258** |

**10,258 is the honest target**, across **90 rules**. The gap to today's 6,569
is three separate concealments, each independently verified:

1. **The debt register** — `dev/lint/oxlint.baseline.jsonc`, 566 lines of
   `overrides`. Hides **922**.
2. **Per-file exemptions in the architecture config** —
   `packages/architecture-enforcer/oxlint.architecture.jsonc:291-333`, seven
   `"off"` entries. The largest single item in this whole plan is here:
   `langwatch/stand-in-cast` goes **225 → 2,081**, so one carve-out hides
   **1,856** findings.
3. **`correctness` never promoted** — see §2. Adds **696**.

### 1a. Almost none of it is machine-fixable

Measured on a full scratch copy of the tree (tracked sources rsynced,
`node_modules` symlinked, the repo itself never written to), at the target
configuration, running all three tiers together —
`--fix --fix-suggestions --fix-dangerously`:

**10,208 → 9,955. 253 fixed, 2.5%.**

(The scratch tree reproduces 10,208 rather than 10,258 because `dist`, `.bin`
and `.venv` were excluded from the copy — a 0.5% difference, immaterial to the
ratio.)

Everything a machine can do, in full:

| rule | before | after | fixed |
| --- | --- | --- | --- |
| `eslint(no-unused-vars)` | 99 | 19 | −80 |
| `react-hooks(exhaustive-deps)` | 137 | 79 | −58 |
| `langwatch(logical-statement-spacing)` | 55 | 0 | −55 |
| `langwatch(banned-test-model-names)` | 16 | 0 | −16 |
| `unicorn(prefer-string-starts-ends-with)` | 11 | 0 | −11 |
| `typescript(array-type)` | 12 | 4 | −8 |
| `langwatch(module-app-only-across-packages)` | 1,072 | 1,063 | −9 |
| `unicorn(no-new-array)` | 6 | 0 | −6 |
| `eslint(no-useless-escape)` | 3 | 0 | −3 |
| six others | | | −7 |

Two cautions on that table. The 58 `exhaustive-deps` fixes come from
`--fix-dangerously`, which **adds dependencies and can change render
behaviour** — review every one by hand; do not batch-apply. And the tiers are
**not cumulative**: `--fix-suggestions` alone skips the safe fixes, so always
pass all three together or you will silently get fewer.

**The planning consequence: 9,955 hand edits.** This is a multi-lane drive
measured in weeks, not a codemod. Size the lanes from §4.

## 2. The finding that matters most: 146 rules report nothing

`.oxlintrc.jsonc` never sets `categories`, so oxlint's built-in **`correctness`
tier resolves to `warn`** — and `pnpm lint:oxlint` passes `--quiet`, which drops
warnings. From the resolved config: **`deny:3 / warn:146 / allow:1`**, and
`categories: {}`.

Proven on a fixture of deliberate bugs: **with `--quiet`, exit 0 and nothing
printed**; without it, the findings appear. So 146 rules — `react-hooks/exhaustive-deps`
(137 real findings in a React product), the whole `oxc` bug-catcher set, and
every registered-but-inert type-aware rule — have been enforcing nothing.

This also falsifies a comment in the tree. `.oxlintrc.jsonc:72` tunes
`vitest/valid-expect` to `maxArgs: 2` and says *"The 9 real ones, an async
matcher never awaited, still report."* They do not: at `warn`, under `--quiet`,
it reports nothing at all.

## 3. Turn it all on — the exact change

One commit. Expect CI red at 10,258 until the drive lands.

1. **`.oxlintrc.jsonc`**
   - Delete `"./dev/lint/oxlint.baseline.jsonc"` from `extends`.
   - Add, above `"plugins"`:
     ```jsonc
     // Oxlint's correctness tier defaults to `warn`, and lint:oxlint runs
     // --quiet, so 146 rules reported nothing at all. Measured 2026-09-17:
     // +696 findings, of which 138 are machine-fixable.
     "categories": { "correctness": "error" },
     ```
   - `"vitest/valid-expect": ["error", { "maxArgs": 2 }]` — it is `warn` today,
     which under `--quiet` means off.
   - Leave `"vitest/require-mock-type-parameters": "off"` **as it is**. Under
     `categories` it would otherwise return at **11,904** findings with no
     codemod. A globally disabled rule is a visible policy decision that applies
     everywhere; it is not a per-file exemption, and it is not what "no
     exemptions" was aimed at. Flag it if you disagree — it more than doubles
     the target.
2. **Delete `dev/lint/oxlint.baseline.jsonc`** outright.
3. **`packages/architecture-enforcer/oxlint.architecture.jsonc`** — delete the
   two exemption override blocks at `:291-299` and `:302-333` (seven `"off"`
   entries: `temporal-only`, `stand-in-cast`, `no-inline-dynamic-import`,
   `condition-shape`, `comment-block-size`, `cognitive-complexity`,
   `empty-catch`). Keep the *enabling* override blocks — `:178`, `:188`, `:237`,
   `:247` turn rules **on** for a path and are not exemptions.
4. **Delete the baseline-reading code**, which is already dead (§5.1).

A note for whoever writes this commit: **oxlint resolves override `files` globs
relative to the config file's directory.** A config that extends
`.oxlintrc.jsonc` from a second level silently loses the parent's overrides —
this cost a measurement round here (`temporal-only` inflated by 224,
`no-unused-vars` by 294, before it was caught). Keep the `extends` chain one
level deep, and never measure from a config outside the repo root.

## 4. The 10,258, sized for lanes

90 rules fire. The head is where the drive lives:

| findings | rule | character of the work |
| --- | --- | --- |
| 2,081 | `langwatch(stand-in-cast)` | the single largest item; entirely hidden by one exemption today |
| 1,072 | `langwatch(module-app-only-across-packages)` | cross-package imports; architectural, not mechanical |
| 1,013 | `langwatch(cognitive-complexity)` | function-by-function decomposition |
| 773 | `langwatch(fallible-result-naming)` | `find*`/`get*` vocabulary; **changes behaviour at call sites** — see the `find-is-not-a-nullable-suffix` and `fallible-rename-changes-the-impl` notes |
| 543 | `langwatch(temporal-only)` | |
| 449 | `eslint(no-nested-ternary)` | |
| 448 | `langwatch(no-try-prefix)` | same hazard as `fallible-result-naming` |
| 380 | `langwatch(package-boundaries)` | |
| 265 | `langwatch(no-inline-dynamic-import)` | |
| 231 | `langwatch(service-classes)` | |
| 216 | `langwatch(condition-shape)` | |
| 182 | `eslint(complexity)` | |
| 159 | `vitest(no-conditional-expect)` | test hygiene |
| 145 | `langwatch(repository-takes-only-its-store)` | |
| 144 | `langwatch(feature-source-layout)` | file moves |
| 137 | `react-hooks(exhaustive-deps)` | 58 auto-fixable, **all needing review** |

The tail — 74 rules under 137 findings each, 1,380 total — is where the
cheapest complete wins are: 20 rules have 10 or fewer findings and can be
closed outright in single sittings.

Two rules in the head, `fallible-result-naming` (773) and `no-try-prefix` (448),
are **not renames**. Repointing a `try*` name at `find*` without narrowing the
catch to the absence case changes what the function does. These want their own
lane with behavioural review, not a bulk sweep.

## 5. Zero-risk work — no finding-count change

These are independently landable, in any order, and none moves the meter.

### 5.1 Delete the dead baseline machinery

`packages/oxlint-rules/src/rules/overengineering.mjs:22` reads
`packages/architecture-enforcer/src/overengineering-baseline.json`. **That file
does not exist**, `existsSync` returns false, and it falls back to an empty
set — so `layer-class`, `conditional-type-depth` and `overload-by-literal` have
been ratcheting against nothing. Delete the baseline read, not recreate the file.

`.github/workflows/langwatch-app-ci.yml:915` fetches four baselines at the merge
base; **three of them are deleted** (`service-ceilings-baseline.json`,
`port-module-baseline.json`, `comment-block-roots.json`; only
`boundary-edge-baseline.json` exists). Those shrink gates are inert. Remove the
three, and under "no baselines" plan the removal of the fourth.

### 5.2 Delete six duplicate ast-grep rules

Each duplicates an oxlint plugin rule with **narrower** path coverage — the
ast-grep copies scope to `apps/**` and `packages/**`, missing all of
`modules/**` — and different wording. One of them blocks CI at `error`.

| ast-grep file | duplicates | keep |
| --- | --- | --- |
| `no-inline-dynamic-import{,-tsx}.yml` | `no-inline-dynamic-import.rule.mjs:34` | the plugin (it carries the 5 exemptions) |
| `use-action-based-test-name{,-tsx}.yml` | `test-description-is-an-action.rule.mjs:74` | the plugin (full-tree, blocking) |
| `require-bdd-describe-context{,-tsx}.yml` | `test-description-is-an-action.rule.mjs:59-67` | the plugin (models the MDN exemption) |

ADR-135 already deleted two such pairs once; three grew back. Delete the six
`.yml`, their fixtures and snapshots, and update ADR-135's registry table.

### 5.3 Stop re-emitting 6,546 `.d.ts` files

`packages/architecture-enforcer/src/policies/quality/declarations.ts:91-95`
calls `ts.createProgram(...)` then `program.emit()` — regenerating the **6,546
`.d.ts` files `tsc -b` already wrote to disk**. Measured: **killed at 6m22s and
3.1 GB, unfinished.** That is why `pnpm lint` passes `--no-declarations`, and
why this policy runs **nowhere** — not locally, not in CI.

Replace the program-and-emit with a read of `dist/**/*.d.ts`;
`reachableDeclarations` (`:44-66`) already works on file text and needs no
change. Guard: refuse with a clear message when a package has a
`tsconfig.build.json` and no `dist/`. Expect new findings from a policy that has
never actually run — measure before landing.

### 5.4 Correct the records

Each of these cost real time to disprove during this audit:

- **ADR-135's registry table** says 34 plugin rules / 30 enabled and 31
  policies. Actual: **72 defined / 71 enabled**, and **36** policies. It also
  names `packages/architecture-enforcer/src/oxlint-baseline.json`, which does
  not exist, and says `pnpm lint` runs oxlint "over a named list of roots" —
  the root config was since changed to `oxlint .` precisely because the path
  list was a denylist by omission that skipped 25 packages. Semgrep (5 rules)
  and 79 vitest architecture guards are in no registry at all.
- **ADR-099** says `typescript/unstable/*` offers none of `createProgram`,
  `readConfigFile`, `createScanner`, `parseJsonConfigFileContent`. As of the
  installed `typescript@7.0.2` that is largely false — `Project.program`,
  `Project.checker`, `API.parseConfigFile`, `unstable/ast/scanner` and 326 `is*`
  predicates all exist.
- **`src/test-utils/tsAst.ts` does not exist.** ADR-099's "one API session" owner
  is `packages/test-harness/src/ts-ast.ts`, and it is one of four parse engines,
  not one. Stale citations: `CLAUDE.md:475`, `pnpm-workspace.yaml:223`,
  `dev/docs/adr/099-*.md:61`.

## 6. "Can lint and tsc share, so we only type once?" — no, because nothing is shared today

- **The enforcer never type-checks.** `getTypeChecker` appears **zero** times in
  `packages/architecture-enforcer/src/`. Its single `ts.createProgram`
  (`declarations.ts:91`) exists only to `emit()`. There is no type-check to
  share, so no mechanism — tsgolint included — removes work that is being done
  twice.
- **oxlint plugins can never receive types.**
  `node_modules/oxlint/dist/plugins-dev.d.ts:3373`: *"Oxlint does not offer any
  parser services."* That is a design position, not a gap. No house rule becomes
  type-aware through that door. `--type-aware` exists but drives
  `oxlint-tsgolint` — **not installed here** — and it powers only built-in rules.

What *is* duplicated and removable: **one emit** (§5.3), and **31 redundant
traversals inside the enforcer** — 23 stray `walkFiles(` sites, 19 stray
`ts.createSourceFile` sites, and 5 policies building their own module resolver
with a cold cache, all bypassing the shared snapshot and mtime-validated parse
cache that exist to prevent exactly this (`src/workspace/module-graph.ts:112`,
`src/workspace/snapshot.ts:590-619`). Five policies are 80% of the enforcer's
81s run: `unused-module-export` 35.8s, `application-boundaries` 7.9s,
`frontend-ui-boundaries` 7.0s, `api-transport-framework` 6.2s,
`boundary-signature-mirrors` 4.4s.

Routing the stray sites through the snapshot is lane L3 of
`architecture-lint-review-2026-09-08.md`, whose exit check ("run time under
10s") was never met — the stray sites are why. Exit check stays the same: the
finding set must be **identical** before and after.

### Incremental is the real win

`changedSourceFiles()` already exists (`src/workspace/changed-files.ts:90-118`),
returns **294 of 15,338 files in 565 ms**, and is wired into **one** of 36
policies. Feed it to every per-file policy and persist per-file facts keyed by
the `{mtimeMs, ctimeMs, size}` tuple `module-graph.ts:82-95` already computes.
Estimated warm run: **81s → 5–8s**.

**Do not key it off `.tsbuildinfo`.** Measured here: two consecutive `tsc -b`
runs emitted byte-identical 15,864-line output, because a project with errors
never writes usable build info. `.tsbuildinfo` answers "what must the compiler
rebuild", which is a different question from "what must a lint re-examine".
Content-hash the facts, and hash the enforcer's own source into the key so a
rule change invalidates everything.

### Do not move the enforcer to TypeScript 7 yet

Its TS-6-only surface is small — 36 call sites across 9 members, of 1,835 `ts.*`
uses — and `pnpm-workspace.yaml:216-224` pins it on a rationale 7.0.2 has since
falsified. But all 19 `createSourceFile` sites become out-of-process round
trips, measured by ADR-099 at 4.7 ms/file unbatched (**72s** over this tree)
against 0.2 ms batched (3s). **The port is worth doing after the parsing is
batched and rare, and worth nothing before.** For now just correct the comment,
which cites a deleted file.

## 7. Also worth enabling — but only after the meter reaches zero

Each is measured, and each adds to a number the drive is trying to empty. None
should land during the drive.

| change | findings added | machine-fixable | why |
| --- | --- | --- | --- |
| `options.reportUnusedDisableDirectives: "error"` | **172** | 0, but each is a one-line deletion | 172 of the tree's 458 suppressions suppress nothing. `packages/prisma-client` holds 140 |
| `import` plugin, six named rules | **91** | 4 | `import/no-cycle` finds **50 real import cycles** nothing else here checks |
| `promise`, three named rules | **51** | 0 | `no-multiple-resolved` (29) is a real double-settle bug class |
| `jsx-a11y`, ten named rules | **89** | 50 | 39 hand edits buys keyboard/ARIA correctness on a product with no other a11y gate |
| install `oxlint-tsgolint`, `--type-aware` | unmeasured | — | lights up 14 registered-but-inert rules. `specs/dependencies/oxc-toolchain.feature` calls it blocking; the old register calls it "the largest single loss in the migration". Measure before committing — it builds a TS program and CI lint will rise materially |
| `-f github` output format | 0 | — | restores the inline diff annotations the CI comment at `:960` records as lost. Only useful once counts are small (GitHub renders 10 annotations per step) |
| commit `.vscode/settings.json` + `extensions.json` | 0 | — | there is **no** `.vscode/` (gitignored at `.gitignore:35`) and no editor config anywhere: CI enforces thousands of errors a developer's editor shows none of |

**Enable named rules, never a category.** Measured whole-tier costs, for the
record: `suspicious` 41,117 · `pedantic` 46,750 · `style` **611,127** ·
`restriction` 231,231 · `nursery` 14,100.

## 8. Rejected, with the reason

| rejected | measured | why |
| --- | --- | --- |
| `jsdoc` plugin | 19,481 correctness / 54,592 all | no house JSDoc convention, no codemod |
| `react-perf` plugin | 8,993 | inline handlers in props are the house idiom; cannot reach zero |
| `node` plugin | 5,761 | `no-sync` 3,748 unfixable; `no-process-env` duplicates `langwatch/secrets-through-source` |
| `nextjs` / `vue` plugins | 0 / 7 | no Next.js; 7 stray Vue files |
| `jest` plugin | 1,488 duplicates | already correctly decided at `.oxlintrc.jsonc:27-31` |
| oxfmt `sortImports` | **+8,598 files** | largest blast radius measured, on top of a 2,072-file backlog |
| any other oxfmt option | whole-tree rewrite | all six options in `.oxfmtrc.json` are **already oxfmt 0.63 defaults**; only `ignorePatterns` is load-bearing |
| `unicorn/no-array-sort` | 1,206 → 5 after fix | 99.6% fixable and tempting, but rewrites 1,201 call sites in one commit. If ever, land it alone |
| `import/no-duplicates` | 901 → 149 after fix | 149 hand edits for an aesthetic merge of two import lines |
| collapsing `tsconfig.json` into `tsconfig.build.json` | 165 packages carry both | the double parse is real but deliberate: build excludes tests and sets `noEmitOnError`, check includes tests and sets `noEmit`. Collapsing either stops checking tests or lets a test failure block consumers' declaration emit. Warm run is 26.8s; leave it |
| oxlint in `.githooks/pre-commit` | 51.2s per commit | unusable at the current JS-plugin cost; the editor LSP is the right pre-CI loop |
| a reviewdog-style diff filter | — | `-f github` gives native annotations for free, and the CI comment at `:944-962` already argues the delta gate away on its merits |

## 9. Two things this plan does not fix

- **The format gate is red now.** `oxfmt --check` reports **2,072 unformatted
  files**, exit 1 (1,321 `.ts`, 241 `.tsx`, 189 `.md`, 152 `.mdx`, 77 `.mjs`,
  77 `.json`). Only **20** are dirty in the working tree, so ~2,050 are
  committed that way. `pnpm format:check` is blocking at
  `.github/workflows/langwatch-app-ci.yml:891`. **The user is handling this
  separately.**
- **The check-queue shims are not installed in this checkout.**
  `node_modules/.bin/{oxlint,oxfmt,tsc,vitest}` are byte-identical to their
  `.real` backups — plain pnpm shims. A `pnpm install` regenerated the bins and
  the postinstall shim was never reapplied, so **`tsc` does not queue here right
  now**, and the "the queue serialises agents" assumption does not currently
  hold. Out of scope for this plan, but it affects anyone running the drive in
  parallel.

## How to measure

The traps below each produced a confident wrong answer during this audit.

- **Never pipe oxlint.** It exits without flushing stdout, so piping truncates.
  Three identical piped runs of one tree returned 3,712 / 4,646 / 7,956 against
  a true 8,176. Always redirect to a file, then grep the file:
  ```bash
  pnpm exec oxlint --quiet --config .oxlintrc.jsonc . > /tmp/lint.txt 2>&1
  grep -cE '^[a-zA-Z0-9_./@-]+\.(ts|tsx|mjs|js|cjs|mts)[^ ]*:[0-9]+:[0-9]+: error' /tmp/lint.txt
  ```
- **Run from the repo root.** Path-scoped `langwatch` rules match
  `^(apps|modules|enterprise)/` against the workspace-relative path; from
  anywhere else they silently disable and undercount by ~2,000.
- **Override `files` globs resolve relative to the config file's directory.** A
  scratch config outside the root silently drops every exemption.
- **`grep -cE 'error TS'` on tsc output always returns 0** — tsc colourises, so
  the bytes are `error<ESC>[0m<ESC>[90m TS2307:`. Strip with
  `sed -E 's/\x1b\[[0-9;:]*m//g'` first.
- **`tsc -b` is incremental**: a repeat run prints nothing and still exits 1.
  Empty output is not zero errors — check the exit code.
- **`$?` after a pipeline is the last command's status**, not the check's.
- **`--print-config` is not re-ingestible** in 1.78.0: it wraps rule options one
  array too deep and materialises defaults as explicit `warn`, which then blocks
  `categories` from lifting them. **`--debug=timings` prints nothing at all.**
