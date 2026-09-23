# ADR-142: A test that cannot fail is worse than no test

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: the ast-grep rows are plugin rules or
gone, and the test rules the plugin already held have rows (see the last section).

**Behavioural contract:**
[the assertion-coverage built-in](../../../specs/tooling/lint-test-shapes.feature),
[tautological assertions](../../../specs/tooling/lint-no-tautological-assertion.feature),
[form watch in a child](../../../specs/tooling/lint-no-form-watch-in-child.feature),
[test descriptions](../../../specs/tooling/lint-test-description-is-an-action.feature)

**Related:** [ADR-135: the toolchain](./135-lint-and-format-toolchain.md),
[the testing philosophy](../TESTING_PHILOSOPHY.md)

## Context

Every rule in this family exists because the failing shape reports as coverage.
An empty `it()` body passes. A test with no `expect` passes as long as nothing
throws. `expect(x).toBe(x)` passes through any rewrite of the thing it appears
to cover. A test whose subject is mocked passes because the mock passes. None
of these shows up as a gap in a coverage number or in a green run; they show up
as a bug in production beside a test file that claimed the path.

Two of them are about how a test reads rather than whether it can fail.
`it("should check local first")` and `describe("submit behavior")` produce
failure output that a reader has to open the file to understand, and the house
convention - action-based names, `describe("given ...")` and
`describe("when ...")` - is what makes the output stand on its own. That
convention is in `CLAUDE.md`, and before these rules it was enforced by whoever
noticed.

The React form rules sit here because they fail the same way: nothing breaks,
the form just re-renders on every keystroke or disables its own submit button
before the user has done anything wrong.

## Decision

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/no-tautological-assertion` | plugin | `expect(x).toBe(x)` and its kin compare a value with itself and cannot fail. |
| `langwatch/no-form-watch-in-child` | plugin | A component holding `form` as a prop uses `useWatch`, never `form.watch()`. |
| `langwatch/test-description-is-an-action` | plugin | Nested `describe` blocks read `given <precondition>` then `when <action>`. |
| `langwatch/shared-setup-is-a-hook` | plugin | Setup repeated across sibling tests belongs in a hook. |
| `langwatch/unit-test-does-not-render` | plugin | A test that renders a component is an integration test, not a unit test. |
| `langwatch/banned-test-model-names` | plugin | A test names `gpt-5-mini`, not a retired or overpriced model. Fixable. |
| `langwatch/no-logger-spy` | plugin | No `vi.spyOn` on a real logger; assert through `createTestLogger()`. |
| `langwatch/no-prototype-stub` | plugin | No test double built by `Object.create(Class.prototype)`. |
| `vitest/valid-expect` | oxlint built-in | `expect` takes at most two arguments; the second labels which iteration failed. |
| `vitest/expect-expect` | oxlint built-in | A test calls `expect` or a named `expect*`/`assert*` helper; a test that asserts nothing cannot fail. |
| `vitest/valid-title` | oxlint built-in | A test title is a string and does not start with "should". |
| `vitest/require-mock-type-parameters` | oxlint built-in | Off (amendment below). |

`no-test-without-assertion` and `no-empty-test` were ast-grep rules that
duplicated `vitest/expect-expect`, a built-in already enabled at oxlint's own
default (warn) through the config's `vitest` plugin, before and after this
change. ADR-135's class-A migration deleted both ast-grep rules; the built-in
was measured, not additionally adopted, because no baseline rows exist for it
to re-key and `pnpm lint:oxlint --quiet` makes its "warn" severity invisible
either way - the built-in flags 17 files beyond the three the two ast-grep
rules together found (all of which it also finds), so nothing that used to
fail now passes silently, but nothing newly fails either, since the severity
and enablement are unchanged from before this migration. `vitest/expect-expect`
has since become a rule of record: the correctness category runs it at error, and
its row above names the helpers it trusts (Alex, 2026-09-23). The trade recorded in ADR-135 still applies
going forward: the review bot no longer quotes these two shapes back on the
diff, only oxlint's own flat message.

`vitest/valid-title` is not a substitute for either shape below. Its
`mustNotMatch` option did not fire on `it("should ...")` in the pinned oxlint
build, verified. Nor can it express the nested-`describe` check, which needs
the nesting depth of the `describe` it is looking at.

## Amendment, 2026-09-15: `vitest/require-mock-type-parameters` is off

Enabling the `vitest` plugin to name the test-quality rules brought its whole
ruleset, and one member of it reported 11,741 findings across 1,700 files -- half
of every finding in the repository -- each one a `vi.fn()` written without a type
parameter. It has no fixer and can have none: the type argument has to be the
mocked function's real signature, so there is no codemod, only 1,700 files of
hand-resolution. `vi.fn()` bare is the idiom the whole suite is written in.

It is off rather than baselined. The rule only ever fires in tests, so a baseline
covering the existing files and an off switch are the same decision said at
different lengths -- and a rule that can never reach zero teaches people to read
past the linter, which costs more than the rule was ever going to earn.

## Amendment, 2026-09-17: `use-action-based-test-name` and `require-bdd-describe-context` (ast-grep) deleted as duplicates

Both ast-grep rules duplicated `langwatch/test-description-is-an-action`, the
oxlint plugin rule that already covers the should-prefix and the nested-context
checks — and covers more of the tree doing it: the ast-grep pair was scoped to
`apps/**` + `packages/**`, missing every file under `modules/**`. The plugin
rule is the one of record now; their files, fixtures and table rows are gone.
See `specs/tooling/lint-test-description-is-an-action.feature`.

## Consequences

The two failure modes these rules cannot catch are the important ones: a test
that asserts something true but irrelevant, and a test that asserts on the
generated string instead of executing the path that crashed. Both are review
judgments. The rules take the mechanical cases off the reviewer's plate so the
judgment has room.

Test names are checked by a rule, so a rename is a lint fix rather than a
review round. The cost is that a legitimately awkward name now needs an
inline suppression, and a suppression in a test file is a fair prompt to ask
what the test is really about.

## Amendment, 2026-09-23: the plugin holds the test rules

ast-grep was removed. `no-tautological-assertion` and `no-form-watch-in-child`
are plugin rules now; `no-form-disable-on-isvalid` was deleted without a port.
The `test-quality` policy left the architecture-enforcer registry (its
`--review-test-quality` report remains).

`vitest/valid-title` is now configured with `mustNotMatch` refusing a leading
"should" on `it` and `test`, and the plugin-config guard pins that setting.
Whether the pinned build fires on every such title was not re-measured. `langwatch/test-description-is-an-action` still owns
the nested-`describe` check.
