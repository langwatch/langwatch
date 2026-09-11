# Why `.oxlintrc.architecture.json` looks the way it does

The config itself is the rules. This is everything that is *history* about
them: what was measured, what was rejected, what Biome used to do, and which
lists are machine-written. A comment in the config that only records one of
those belongs here instead, so the config stays readable as a list of decisions
in force.

Companion documents: `dev/docs/lint-rules.md` (generated, one entry per
`langwatch/*` rule) and ADR-135 / ADR-140 / ADR-141 / ADR-142 (the toolchain
decisions).

## The doctrine, in one paragraph

Every rule in this config is `error`, and every one was measured before it was
turned on. There is no warn tier: `pnpm lint:oxlint` runs with `--quiet`, and
nothing here annotates a review, so a warning would block nothing and be seen
by nobody. A rule earns its place by reaching a zero baseline — either the tree
was already clean, or the change that added the rule made it clean — or by
being held in a register that can only shrink. That is what keeps
`pnpm lint:architecture` a gate rather than a report. The globs cover `apps/**`
as well as `packages/**` on purpose: a file does not change its checks by
moving.

The `langwatch/*` rules differ from the native ones in the way that matters
here: a plugin rule consults
`packages/architecture-lint/src/oxlint-baseline.json` itself, so it needs no
override. A native rule cannot, which is why the three generated overrides at
the bottom of the config exist.

## Registers still in force

**`langwatch/boolean-wall`, `packages/architecture-lint/src` only.** Measured
2026-09-06: 48 boolean walls over 9 files, mostly TS-AST predicate helpers
(`isPropertyName`, `isBindingName`, `unwrap`) that return one long `&&` / `||`
chain directly. Splitting each into named intermediate predicates is real
refactoring, not a rename, so the 9 files are held rather than switching the
rule off package-wide. `logical-statement-spacing`, the sibling rule enabled on
the same paths, auto-fixes cleanly and carries no register.

**`max-depth`.** Four nested blocks inside one function is already where a
reader has to hold the whole stack in their head. At max 4 the baseline was 35
hits in 15 files; those 15 are pinned at 6 by the register and can only shrink.

**`no-useless-assignment`.** Two findings in two files, the whole of `apps/**`'s
debt under the quality block.

**`no-shadow` is scoped rather than baselined.** 99 hits across 45 files,
concentrated in web components and test setup. It is on where the domain lives
and where a shadowed identifier is most expensive: contract source (already
clean) and server source (7 hits across 5 files, fixed when the rule landed).
Narrowing the scope is the honest version of a baseline — everything inside it
is clean and stays clean, instead of one number nobody reads.

## Shrink-only baselines seeded by measurement

These rules ship at `error` with their existing findings seeded into
`oxlint-baseline.json`. A new finding is a hard failure; an existing row may
only be deleted.

| Rule | Measured | Finding |
| --- | --- | --- |
| `langwatch/refusal-is-a-handled-error` | 2026-09-10 | 70 files, 80 reports, 20 modules. The channel conversion (ADR-144 decision 9) empties `services/` of conduits and the rows go with it |
| `langwatch/dangling-barrel-export` | 2026-09-10 | 80 reports across 30 files, every one a specifier no file answers to, left by an in-flight move |
| `langwatch/empty-catch` | 2026-09-10 | 320 reports across 216 files |
| `langwatch/stand-in-cast` | 2026-09-10 | 328 reports across 178 files |
| `langwatch/transport-imports-a-repository` | 2026-09-10 | 9 reports across 9 files |

`langwatch/no-port-vocabulary` bans the word outright; its baseline is every
file that still carries it.

## Options that look like an accident and are not

**`eqeqeq` carries `{ "null": "ignore" }`.** `x == null` is the idiomatic
single check for null-or-undefined and this codebase uses it deliberately: 133
of the 226 raw `eqeqeq` hits were that idiom, and "fixing" them replaces one
correct check with two. With the option on, the baseline is 0. Biome's
`noDoubleEquals` ignored it by default too, and reported the same 56 on the
tree the second ruleset came from.

**`no-return-assign` is `"always"`.** Biome's `noReturnAssign` flagged
`return a = b` whether or not it was parenthesised, which is eslint's
`"always"` rather than its default `"except-parens"`. At the default this
measures 0 and is inert; at `"always"` it measures the 10 Biome had.

**`max-nested-callbacks` is 3 outside tests and 6 inside them.** The mandated
`describe("given") / describe("when") / it()` nesting spends three levels
before a test callback does anything at all; at max 3 it reports 12,094
findings that are the house structure. At 6 the test tree is clean, at 5 it is
70 findings, and the rule still holds the shape it exists to hold.

**`complexity` and `langwatch/cognitive-complexity` are 40 in test files**, 25
and 15 elsewhere. A table-driven test or a fixture scanner legitimately
branches more than a service method.

**The test-quality rules are scoped to test files.** Biome scoped them for a
reason it wrote down: unscoped, `no-focused-tests` matches any function called
`fit(...)` and fires on a production zoom hook.

## Measured and rejected, `apps/**` + `packages/**`

So the next person does not spend an afternoon re-litigating them.

| Rule | Findings | Why not |
| --- | --- | --- |
| `no-magic-numbers` | 19882 | every threshold and index |
| `id-length` (min 2) | 4163 | `i`, `j`, `e` are conventional |
| `require-await` | 2351 | async-for-interface is a real shape |
| `typescript/no-non-null-assertion` | 1797 | 489 source, 1308 test |
| `no-negated-condition` | 612 | unicorn variant 311 |
| `max-classes-per-file` (1) | 332 | |
| `no-await-in-loop` | 388 in 170 files | sequential iteration is often the point (ordering, backpressure), which a linter cannot tell from a missed batch |
| `no-eq-null` | 226 | this is the `== null` idiom; rejected on principle, not on count |
| `max-params` (max 4) | 85 in 69 files | at max 3 it is 241. CLAUDE.md's named-parameters rule wants this, but no threshold cheap enough to adopt is tight enough to mean anything |
| `typescript/no-extraneous-class` | 54 in 47 files | |
| `typescript/no-import-type-side-effects` | 34 in 33 files | |
| `no-loop-func` | 2 | both are the same deliberate abort-latch: the closure exists in order to publish itself to the outer `wake` binding. Adopting it buys a rewrite of correct code or a suppression |

Measured and left off from the Biome carry-over, same rule — a backlog big
enough that a register would be the whole tree:

| Rule | Findings |
| --- | --- |
| `max-lines-per-function` | 4730 (Biome `noExcessiveLinesPerFunction`, warn; 747 on the surviving paths) |
| `typescript/consistent-type-imports` | 260 in 205 files (`useImportType`) |
| `max-params` | 223 (`useMaxParams`; rejected above as well) |
| `no-shadow` | 433 (on for contract and server only, above) |
| `max-depth` | 82 (on with a register, above) |
| `no-useless-assignment` | 25 |
| `vitest/no-disabled-tests` | 43 (`noSkippedTests`, Biome warn) |
| `jest/no-standalone-expect` | 135 (`noMisplacedAssertion`, Biome warn) |

## The Biome carry-over

The second quality block is the ruleset the deleted platform application's
`biome.jsonc` carried. Biome was that application's general-purpose linter and
oxlint was the packages' one; when Biome was removed, this is where its ruleset
had to live or stop existing. The application it was measured over is gone, so
the `// was noFooBar, 12` notes in the config are **history**: they record what
the rule found in the tree it came from, not what it finds here. Every count
was measured with oxlint 1.78.0 at the commit that removed Biome.

Where Biome's severity was `warn` it blocked on ADDED lines only, through a
reviewdog pass that no longer exists. A warn tier cannot be carried across, so
every carried rule is `error`.

`no-unused-vars` is one rule where Biome had three: `noUnusedImports` (error,
42 live violations), `noUnusedVariables` (warn, 37) and
`noUnusedFunctionParameters` (warn, 73). oxlint reports all three shapes as
`no-unused-vars` — 151 findings over 93 files when it landed. The 42 unused
imports were failing `pnpm lint` before that change, so the register recorded
real debt, not a change of mind. `no-cond-assign: ["error", "always"]` is the
narrow half of `noAssignInExpressions` — an assignment used as a condition, 19
findings; oxlint has nothing for the general shape (`foo(a = 1)`).

### Biome rules with no oxlint equivalent

None of these is retired because it stopped being desirable.

| Biome rule | Findings | Status |
| --- | --- | --- |
| `noFloatingPromises` | 39 | TYPE-AWARE. oxlint ships `typescript/no-floating-promises` and `typescript/no-misused-promises`, but they need `--type-aware` and the `oxlint-tsgolint` companion binary, which is not a dependency of this repository. Enabling the names without it silences nothing and reports nothing. The largest single loss in the migration, and the blocker named by `specs/dependencies/oxc-toolchain.feature` ("Type-aware promise checks remain blocking") |
| `noMisusedPromises` | 19 | same |
| `useOptionalChain` | 2 | same: `typescript/prefer-optional-chain` is type-aware only. Verified inert without `--type-aware` on a fixture (`foo && foo.bar`) |
| `useLiteralKeys` | 0 | same, `typescript/dot-notation` (`o["k"]`) |
| `noMisrefactoredShorthandAssign` | | `a =- b` for `a -= b`. Neither oxlint nor eslint has a rule for it |
| `noImplicitAnyLet` | 35 | No oxlint rule. `let x;` widening to any is a TypeScript-semantics check and lands with type-aware linting or not at all |
| `noEvolvingTypes` | 46 | same |
| `useAsConstAssertion` | | No oxlint rule |
| `useForOf` | | No oxlint rule (`unicorn/no-for-loop` does not exist in 1.78.0) |
| `useSpreadOverApply` | | oxlint's `prefer-spread` is a different rule: 212 findings here against Biome's 0, so it is not a carry |
| `noForIn` | 2 | `guard-for-in` is the nearest and is narrower: it requires a guard rather than banning `for-in` |
| `noExcessiveCognitiveComplexity` | 1194 | eslint's `complexity` is cyclomatic, not cognitive. Biome never blocked on this one either — its baseline was four figures |
| Next.js rules | | `noHeadElement`, `noImgElement`, `noDocumentImportInPage`, `noHeadImportInDocument`, `noNextAsyncClientComponent`, `noUnwantedPolyfillio`, `useGoogleFontPreconnect`, `useGoogleFontDisplay`, `noSyncScripts`. The app is a Vite app; these had nothing to match before the move and have nothing now |

## The class-A migration (ADR-135 / ADR-140)

It deleted `langwatch/nested-ternary`, `langwatch/runtime-undefined` and the
ast-grep `no-explicit-any` / `no-empty-test` / `no-test-without-assertion`
trio in favour of oxlint built-ins, with three different outcomes.

- **`no-nested-ternary` was adopted.** Its 342 baseline entries re-keyed
  cleanly from `nested-ternary|` to `no-nested-ternary|`, and the generated
  native-rule override suppresses every baselined file, leaving zero new
  findings.
- **`no-undefined` was not.** Measured at 11,568 findings across 3,591 files
  (`runtime-undefined` had never been wired into any config, so every one is
  new). No baseline entries exist to re-key, and a register that size is
  exactly the hand-written override the baseline mechanism replaced. Left off
  pending a decision.
- **`typescript/no-explicit-any` and `vitest/expect-expect` were not.** They
  have no baseline rows either (ast-grep never wrote to that file), and
  `pnpm lint:oxlint` runs with `--quiet`, which makes `warn` invisible and an
  unbaselined `error` a hard failure on every finding. Either would be
  advisory-only noise or an immediate red build, neither of which is what
  "enabled" means. See ADR-141 / ADR-142.

## The generated overrides

`max-depth`, `complexity` and `no-nested-ternary` are native oxlint rules and
cannot read `oxlint-baseline.json` the way a plugin rule does, so their
per-file exemptions are written out longhand. Regenerate them, never hand-edit
the file lists:

```bash
node packages/architecture-lint/src/generate-native-baseline-overrides.mjs
```

They must stay the **last** override for each of those rules. oxlint applies
overrides in array order and later wins, so the blanket test-file thresholds
above would otherwise shadow the generated exemption for a baselined test file.

## The register that closed the file

It is gone. Every entry named a file in the deleted platform application, so it
pinned nothing, and a register that names no existing file reads as coverage
while being only noise. The rules stand unconditionally.
