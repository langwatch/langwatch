# ADR-143: oxfmt is the only formatter, and it reads one configuration

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:** [Formatting](../../../specs/tooling/lint-formatting.feature)

**Related:** [ADR-135: the lint and format toolchain](./135-lint-and-format-toolchain.md)

## Context

Formatting is not a matter of taste once more than one person edits a file: a
disagreement between two formatters shows up as a diff nobody wrote, on lines
nobody touched, in a review that then has nothing to say about the change. The
repository has been through Prettier and through Biome. It now has one
formatter, `oxfmt`, and the only useful property of the choice is that there is
exactly one.

Two things make "one formatter" harder than installing one. The first is
configuration discovery: a formatter that walks up from each file and honours
whatever configuration it finds formats the same file two ways depending on
which directory the command was run from. `sdks/typescript` and `sdks/python`
carry their own `.editorconfig`, and a developer machine routinely has whole
checkouts of this repository nested inside it under `.claude/worktrees/` and
`.codex/worktrees/`. The second is generated and vendored files, which have a
canonical form that is whatever produced them.

## Decision

### One formatter, one command, one configuration file

`pnpm format` is `oxfmt --write --disable-nested-config .` and `pnpm
format:check` is the same with `--check`. Both run over the whole tree from the
workspace root; neither takes a check-queue slot today, because oxfmt's cost is
a fraction of a type-check's.

`--disable-nested-config` is the load-bearing flag, and it is part of every
documented invocation, including the one-file form the skills teach
(`pnpm exec oxfmt --write --disable-nested-config <files>`). It makes the root
`.oxfmtrc.json` the only configuration that applies, so a file's formatting is
a property of the file, not of the working directory the formatter was started
in.

### What `.oxfmtrc.json` sets, and why

| Setting | Value | Reason |
| --- | --- | --- |
| `printWidth` | 100 | The width the repository's code was already written at. Narrower reflows every argument list. |
| `tabWidth` / `useTabs` | 2, spaces | Matches the existing tree and the SDK `.editorconfig` files. |
| `semi` | true | Removes the whole class of automatic-semicolon-insertion surprises. |
| `singleQuote` | false | Double quotes, so a string containing an apostrophe does not change quoting style. |
| `trailingComma` | all | A one-line diff when an argument is appended, rather than two. |

`ignorePatterns` holds three kinds of path and nothing else: build output and
dependency trees (`node_modules`, `dist`, `build`, `coverage`, `.next`),
generated or vendored artefacts whose canonical form is their generator's
(`**/generated/**`, the named `.generated.*` files, `**/vendor/**`, minified
files, lockfiles, Helm templates, `docs/docs.json`), and fixtures whose exact
bytes are the test (`**/testdata/**`, `**/fixtures/**`, `**/__fixtures__/**`,
`specs/webhooks/signature-vectors.json`). A path is added to this list when
formatting it would destroy information, never to avoid fixing a file.

### Prose conventions are review rules, not tooling

British English, no em dashes, no marketing register, no abbreviations in
user-facing copy: these are in `CLAUDE.md` and in the tone-of-voice skill, and
they are enforced by review. No formatter or linter checks them here. Two
reasons. A prose rule that fires on a string literal cannot tell copy from an
identifier, a URL or a test fixture, so it produces false positives on exactly
the files where prose matters least. And the Go side already demonstrates the
cost: `golangci-lint`'s `misspell` enforces US spelling, so `behaviour` fails
in Go while the surrounding prose deliberately uses British forms. Adding a
prose linter to the TypeScript side would make that inconsistency systematic
rather than confined to one language's tooling.

## Consequences

`format` and `format:check` disagree with no other tool, because there is no
other tool. A new formatter, or a second configuration file, is a change to
this ADR.

The `--disable-nested-config` flag has to be repeated in every ad-hoc
invocation, and the failure mode when it is forgotten is silent: the file is
formatted, just differently. That is the price of not deleting the SDK
`.editorconfig` files, which serve editors rather than this formatter.
