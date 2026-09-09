# ADR-135: One linter, one formatter, and four places a rule may live

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[The rule registries and their records](../../../specs/tooling/lint-toolchain.feature),
[the baseline](../../../specs/tooling/lint-baseline.feature),
[the generated rule reference](../../../specs/tooling/lint-rule-docs.feature)

**Related:** [ADR-136](./136-package-and-layer-boundaries.md),
[ADR-137](./137-module-source-grammar.md),
[ADR-138](./138-persistence-containment.md),
[ADR-139](./139-errors-results-and-naming.md),
[ADR-140](./140-complexity-and-readability-budgets.md),
[ADR-141](./141-platform-invariants.md),
[ADR-142](./142-test-quality-rules.md),
[ADR-143](./143-formatting.md)

## Context

The repository enforces about ninety house rules. Nobody wrote down why any of
them exists, so every one of them is one impatient afternoon away from being
switched off, and every new rule is written wherever its author happened to be
standing rather than where it belongs. Two of the ast-grep rules already
duplicate an oxlint plugin rule that was written later; one plugin rule has
never been wired into the config at all; five more are registered in the plugin
and named in the generated reference but enabled nowhere.

The rules also live in four different mechanisms, and the reason is not
arbitrary. oxlint runs in Rust over one file at a time. Its JavaScript plugin
runs in a Node bridge, still one file at a time, but with the workspace path,
the module's role and the shared baseline in hand. ast-grep is a separate
pinned CLI that matches syntax patterns and is what CodeRabbit reads during
review. architecture-lint loads a `WorkspaceSnapshot` - every manifest, the
module catalogue, the Prisma schema, the package graph and the spec tree - and
answers questions no single-file linter can be asked, such as whether the
package graph has a cycle or whether two modules claim the same table.

A rule written one layer too high costs the run time it does not need and
reports a worse message. A rule written one layer too low cannot see the fact
it is trying to check, and is usually then written as a regular expression over
a path.

## Decision

### oxlint and oxfmt are the whole toolchain

`pnpm lint` is oxlint with `.oxlintrc.architecture.json` over a named list of
application, module and package roots, followed by architecture-lint over the
whole workspace snapshot; `pnpm format` is oxfmt. There is no ESLint, no Prettier and no Biome, and adding one back is an
ADR of its own. ADR-143 covers the formatter.

### A rule lives in the lowest layer that can express it

In order:

1. **An oxlint built-in**, if one means the same thing.
2. **oxlint configuration** - `no-restricted-imports`, `no-restricted-globals`,
   `no-restricted-properties`, `no-restricted-types` and an `overrides` block -
   if the rule is "this file kind may not name that thing".
3. **The `langwatch` JavaScript plugin** (`packages/lint-core`), if the rule
   needs the AST, the file's classified role, or the shared baseline. This is
   also the only route for anything oxlint's config cannot say at all: oxlint
   has no `no-restricted-syntax`, so there is no generic AST-selector escape
   hatch in configuration.
4. **ast-grep**, for a syntactic shape the plugin does not see and for the
   rules we want CodeRabbit to quote back during review. It is a pinned CLI
   with committed fixtures, gated in CI.
5. **architecture-lint**, for anything that reads more than the file in front
   of it.

Layer 3 buys message quality as well as reach: a `defineRule` message is a
structured `{what, why, fix}`, rendered into `dev/docs/lint-rules.md` from the
declaration itself. `no-restricted-imports` gives one flat string.

### The registries

| Registry | Where | Count | Enforced by |
| --- | --- | --- | --- |
| oxlint built-ins | `.oxlintrc.architecture.json` `rules` and `overrides` | 1 workspace-wide, the rest scoped | `pnpm lint` |
| `langwatch` plugin | `packages/lint-core/src/rules/*.rule.mjs` | 36 defined, 31 enabled | `pnpm lint` |
| ast-grep | `dev/lint/ast-grep/rules/*.yml` | 18 rules in 29 files | the `ast-grep` CI job and CodeRabbit |
| architecture-lint | `packages/architecture-lint/src/policies/index.ts` | 31 policies | `pnpm lint:architecture` |

### The baseline is a ratchet, not an amnesty

`packages/architecture-lint/src/oxlint-baseline.json` holds 2,586 entries
across 10 rules, keyed `rule|file` with a `measured` date. A plugin rule
consults it directly and reports nothing for a listed file; the two native
rules that cannot read it get a generated `overrides` block. The `oxlint`
policy checks the ledger against the merge-base and refuses any entry that is
new or undated, so the file may only shrink. This is why
`langwatch/nested-ternary` exists beside the built-in `no-nested-ternary`, and
why the mechanism survives even if every class A and B rule below moves.

### Toolchain-owned policies

| Rule | Layer | Meaning |
| --- | --- | --- |
| `oxlint` | architecture-lint | The oxlint baseline is shrink-only and every entry carries a measured date. |
| `comment-block-root` | architecture-lint | The allowed roots for long comment blocks are a ratcheted list, not a free-for-all. |
| `comment-block-review` | architecture-lint | The 4 to 5 line review tier is registered so it can be listed and queried; it never fails a run. |
| `langwatch/runtime-undefined` | plugin | Ambient `undefined` is written `void 0`. Defined, tested and documented, wired into no config. |

### A decision table has one shape, and the guard reads it

A decision table in these ADRs is a markdown table whose header row is exactly
`| Rule | Layer | Meaning |`. The first cell of each row is the rule id in
backticks. Nothing else in an ADR is parsed, so a table of settings or of
registries is invisible to the guard and needs no escaping.

A rule's spec record is resolved in this order: a `Rule:` line under
`specs/tooling/` naming the rule id in backticks; failing that, the
conventional `specs/tooling/lint-<name>.feature` for a plugin rule, which is
the same path `dev/docs/lint-rules.md` renders; failing that, the `spec` a
policy registers in `packages/architecture-lint/src/policies/index.ts`.

## Consequences

Every rule now has one address: a row in one of these nine ADRs, a `Rule:`
block in `specs/tooling/`, and a bound scenario. A drift guard
(`packages/architecture-lint/tests/lint-rule-records.unit.test.mjs`) enumerates
the three registries and fails when a rule has no ADR row, when an ADR row
names a rule that no longer exists, or when a rule has no spec. Adding a rule
is therefore three files, and deleting one is three files.

A second guard
(`packages/architecture-lint/tests/ast-grep-rule-fixtures.unit.test.mjs`) pairs
every ast-grep rule with its fixture. The `ast-grep test` CI step proves a rule
still matches the fixture it has; it cannot notice a rule that has none, which
is how `no-form-watch-in-child` once matched nothing unnoticed.

The layering rule is not retrospective. The classification behind this ADR
found rules sitting above the layer that could express them, and moving them is
a separate change with its own cost, recorded here rather than done here:

- **Two ast-grep rules duplicate a plugin rule that was written later.**
  `no-same-name-delegation` is `langwatch/layer-class`; `no-try-prefixed-name`
  is `langwatch/fallible-result-naming`. Both plugin rules are enabled. The
  ast-grep pair can be deleted with no replacement, at the cost of what
  CodeRabbit quotes in review.
- **Three ast-grep rules have a built-in equivalent.** `no-explicit-any` is
  `typescript/no-explicit-any` (off in the config at 1,395 hits, which is the
  actual reason it lives in ast-grep); `no-empty-test` and
  `no-test-without-assertion` are both covered by `vitest/expect-expect`.
- **Seven plugin rules could be oxlint configuration.** `temporal-only`,
  `environment-boundaries`, `id-generation-origin`, `prisma-containment`,
  `web-imports-server-shaped-value`, `service-dependencies` and
  `nested-ternary` are all "this file kind may not name that thing", verified
  expressible with `no-restricted-*` and an `overrides` allowlist. Moving them
  deletes about 677 lines across seven rule files and seven suites.
  It also costs three things: 718 of the 2,586 baseline entries belong to
  those rules and would become either a hard failure or 718 hand-written
  override paths, which is exactly what the baseline replaced; the structured
  `{what, why, fix}` message becomes one flat string; and
  `package-boundaries` cannot follow them, because its `sealedExports` check
  reads the *target* package's `exports` map and its `featureLayer` check
  needs the layer rank of both ends.
- **`no-dupe-class-members` is available and not enabled**, while
  `langwatch/service-quality` reimplements half of it.
- **Five plugin rules are registered and enabled nowhere**:
  `awaited-return-chain`, `max-statements-per-line`, `service-member-spacing`,
  `service-quality` and `runtime-undefined`. They are tested, documented and
  inert. Each needs a decision: wire it or delete it.

None of these is a licence to delete a rule quietly. Each is a change with an
ADR amendment attached.
