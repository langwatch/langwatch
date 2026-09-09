# ADR-142: A test that cannot fail is worse than no test

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[The ast-grep test shapes](../../../specs/tooling/lint-test-shapes.feature),
[architecture test quality](../../../packages/architecture-lint/specs/feature-package-boundaries.feature)

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
| `no-test-without-assertion` | ast-grep | A test with no `expect(...)` is a smoke test wearing a unit test's name. |
| `no-empty-test` | ast-grep | An empty body is `it.todo(...)`, so the runner counts it as outstanding rather than green. |
| `no-tautological-assertion` | ast-grep | Comparing an expression to itself, or a literal to the same literal, tests the assertion library. |
| `use-action-based-test-name` | ast-grep | `it("checks local first")`, not `it("should check local first")`. |
| `require-bdd-describe-context` | ast-grep | A nested `describe` states a condition: `given <precondition>` or `when <action>`. |
| `no-form-watch-in-child` | ast-grep | A child component holding `form` as a prop uses `useWatch`, never `form.watch()`. |
| `no-form-disable-on-isvalid` | ast-grep | Disable a submit button while the request is in flight, not on form validity. |
| `test-quality` | architecture-lint | Tests with no real assertion, duplicated bodies, a mocked subject, or an empty snapshot, across the workspace. |

`vitest/expect-expect` is enabled through the config's `vitest` plugin and
covers the first two shapes as well, which makes `no-test-without-assertion`
and `no-empty-test` deletion candidates. ADR-135 records why they are still
here: the ast-grep rules are what the review bot quotes back on the diff, and
a rule that only fails CI arrives after the test was written.

`vitest/valid-title` is not a substitute for `use-action-based-test-name`. Its
`mustNotMatch` option did not fire on `it("should ...")` in the pinned oxlint
build, verified. Nor can it express `require-bdd-describe-context`, which needs
the nesting depth of the `describe` it is looking at.

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
