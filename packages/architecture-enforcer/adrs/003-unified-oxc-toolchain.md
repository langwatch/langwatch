# ADR-003: One Oxc lint and format toolchain governs the repository

**Date:** 2026-08-24

**Status:** Accepted

**Behavioural contract:**
[Repository-wide Oxc toolchain](../../../specs/dependencies/oxc-toolchain.feature)

**Related:**
[ADR-001: feature package boundaries](./001-feature-package-boundaries.md),
[ADR-076: single pnpm workspace](../../../dev/docs/adr/076-single-pnpm-workspace.md),
[ADR-090: machine-wide resource governance](../../../dev/docs/adr/090-machine-wide-resource-governance-for-parallel-agents.md),
[ADR-091: agent admission and cost safety](../../../dev/docs/adr/091-haven-gate-agent-admission-and-cost-safety.md), and
[ADR-111: physical application workspaces](../../../dev/docs/adr/111-physical-application-workspaces.md).

## Context

JavaScript and TypeScript checks currently have three owners. Biome lints and
formats only `platform/app`; the TypeScript SDK and MCP package retain separate
ESLint configurations; and Prettier is used ad hoc for files outside the app.
The root `biome.jsonc` is a marker whose purpose is to make a nested app config
work, while CI needs a custom reporter and baseline script to distinguish new
Biome warnings from thousands of accepted legacy findings.

ADR-001 already chose Oxlint for source architecture rules. ADR-076 put every
JavaScript project in one workspace, and ADR-111 removes the monolithic app
whose directory currently owns Biome. Retaining tool-specific islands during
that split would reproduce the package ambiguity the split is intended to
remove: the answer to “what checks this file?” would continue to depend on its
old directory.

The migration must not silently trade coverage for speed. Biome and ESLint
currently enforce type-aware promise checks, test rules, framework rules,
path-specific exceptions and LangWatch house rules. Existing warning debt is
allowed only because CI rejects increases. A replacement is complete only when
those intentions have an explicit destination and local and CI runs use the
same pinned binaries and configuration.

## Decision

Use the Oxc toolchain from the workspace root:

- Oxlint is the sole general-purpose linter for repository-owned JavaScript and
  TypeScript;
- Oxfmt is the sole formatter for first-party file types it supports; and
- the root workspace owns the pinned versions, configuration and commands,
  including `oxlint-tsgolint` while type-aware linting requires that separate
  companion.

This does not replace language-native or purpose-specific analyzers. Go, Python
and other ecosystems retain their native tools. Architecture lint, ast-grep,
Semgrep, gitleaks and generated-file checks continue to own graph, semantic,
security and artifact invariants that are not general JavaScript lint rules.

### One root configuration

The repository has one root Oxlint configuration and one root Oxfmt
configuration. Path-specific environments, rule exceptions and formatting
dialects are expressed as overrides in those files. A workspace package may
offer a convenience script targeting its own directory, but it does not own a
second ruleset or independently pin a lint or format binary.

Root commands have stable meanings:

- `pnpm lint` runs Oxlint read-only over every governed JavaScript and
  TypeScript root, then runs the architecture and specialist lint gates;
- `pnpm lint:fix` applies only enabled safe lint fixes;
- `pnpm format` writes Oxfmt's canonical representation; and
- `pnpm format:check` verifies formatting without writing.

Lint never formats files. Formatting owns layout only: optional import sorting
and package-manifest key sorting remain disabled during this migration so a
formatter invocation cannot change module evaluation or manifest semantics.

Oxfmt covers supported first-party source, configuration and documentation
formats. Generated artifacts, vendored source, lockfiles, test fixtures whose
whitespace is data, and unsupported languages are excluded by narrow,
commented patterns. An exclusion cannot be an unowned directory-wide escape
from formatting.

### Rule intent is migrated before old tools are removed

Every enabled Biome and ESLint rule is inventoried and assigned one of four
outcomes:

1. an equivalent native Oxlint rule;
2. an Oxlint JavaScript plugin rule, including existing LangWatch architecture
   rules;
3. an existing specialist gate when the rule is fundamentally structural or
   semantic; or
4. an explicitly documented retirement explaining why the old rule no longer
   represents desired behavior.

Type-aware TypeScript rules remain enabled wherever the corresponding project
is typecheckable. In particular, floating and misused promise coverage must be
proven before the Biome or typescript-eslint versions disappear. Test-file
rules, browser and Node environments, generated-file exclusions, and the
`no-raw-error-toast` house rule keep fixture coverage and intentional,
reason-bearing suppression mechanisms.

Rules whose existing tree is clean are errors over the full governed scope.
Rules carrying legacy debt keep a checked-in, deterministic baseline keyed by
stable file and rule identity. CI permits the baseline to decrease, rejects an
increase, and never regenerates or raises it automatically. A formatter-only
change cannot make old lint debt appear newly authored.

### Local, filtered and CI checks agree

CI invokes the lockfile-installed root binaries rather than actions that bundle
their own versions. Configuration errors, parser crashes, an unexpectedly
empty governed scope and lint or format violations all fail visibly. Annotation
may be filtered to a pull-request diff, but the gate evaluates the complete
configured scope or the deterministic legacy baseline; annotation is never the
source of enforcement.

Package-filtered checks use the same root rules and versions while narrowing
only the file set. Editor and agent guidance points to the root configurations,
so save-time formatting and diagnostics agree with `pnpm format:check` and
`pnpm lint`.

### Migration is mechanical and reversible

The migration proceeds in this order:

1. inventory Biome and ESLint rules, ignores, plugins, baselines and CI
   behavior;
2. create root Oxlint and Oxfmt configurations with fixture and coverage tests;
3. run old and new lint paths together until every retained rule has parity and
   the new baseline is stable;
4. land Oxfmt's repository-wide rewrite as an isolated mechanical change;
5. switch local scripts, filtered scripts, editors, check shims, Haven
   classification and CI to Oxc; and
6. remove active Biome, ESLint and Prettier-as-formatter dependencies,
   configurations, scripts, gates and instructions.

Historical ADRs and changelog entries remain historical. Active documentation
and examples name only the Oxc commands after cutover. Each migration step
leaves one authoritative required gate; old and new tools are not both required
indefinitely.

## Alternatives considered

Keeping Biome for the app and adding Oxlint only to new packages was rejected
because it preserves directory-dependent policy and duplicates AST traversal.
Keeping ESLint as a permanent fallback was rejected because unsupported rules
can use Oxlint's JavaScript plugin seam or an explicit specialist gate; a
fallback with no removal condition becomes a second standard.

Using Oxlint but retaining Biome or Prettier for formatting was rejected in
favor of one Oxc configuration and release cadence. Allowing every package to
choose its own formatter was rejected because formatting a moved file would
produce unrelated churn and filtered checks would disagree with the root.

Replacing ast-grep, Semgrep, language-native tools or architecture lint was
rejected. They inspect concerns outside the general JavaScript lint and format
surface, and forcing them into one tool would reduce clarity rather than
unifying it.

## Consequences

- Every first-party JavaScript and TypeScript file has one lint policy and one
  formatting policy independent of its workspace location.
- Local, filtered, editor and CI runs use the same lockfile-pinned binaries and
  root configuration.
- Biome's nested-root configuration and custom CI reporter path disappear, as
  do package-local ESLint configurations used only for first-party linting.
- Type-aware and LangWatch-specific rules need explicit parity fixtures before
  cutover; speed alone is not sufficient evidence.
- The initial Oxfmt rewrite is a large mechanical diff and must not be mixed
  with behavior changes.
- Unsupported or formatting-sensitive files require deliberate, reviewed
  exclusions.
- Oxc version upgrades affect the whole workspace and therefore require one
  coordinated lockfile and baseline review.

## References

- [Oxlint: migrate from ESLint](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)
- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config)
- [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config)
- [Oxfmt configuration reference](https://oxc.rs/docs/guide/usage/formatter/config-file-reference)
