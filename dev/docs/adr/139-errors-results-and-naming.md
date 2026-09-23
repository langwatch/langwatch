# ADR-139: A name states what a call answers with

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: the verb prefixes have their own rule,
the explicit result type is a native rule, and the ast-grep rows are gone.

**Behavioural contract:**
[Fallible result naming](../../../specs/tooling/lint-fallible-result-naming.feature),
[condition shape](../../../specs/tooling/lint-condition-shape.feature),
[banned verb prefixes](../../../specs/tooling/lint-banned-verb-prefix.feature),
[overload by literal](../../../specs/tooling/lint-overload-by-literal.feature),
[conditional type depth](../../../specs/tooling/lint-conditional-type-depth.feature),
[Zod object composition](../../../specs/tooling/lint-zod-object-composition.feature)

**Related:** [ADR-045: handled errors](./045-domain-errors-handled-boundary.md),
[ADR-135: the toolchain](./135-lint-and-format-toolchain.md)

## Context

ADR-045 settled what a failure *is*: a `HandledError` when we know the cause
and the caller can act on it, a plain `Error` otherwise. It did not settle how
a call says which of the two it does, and the answer had drifted into the
names. A codebase accumulates `tryFetchUser`, `requireProject`,
`getUserOrNull` and `maybeLoad`, and each of those prefixes is a small private
convention about absence and failure that the next reader has to learn from
the body.

The house convention is the opposite: **the return type carries the contract
and the name agrees with it**. A lookup where absence is a normal outcome the
caller branches on is `find*` and returns `undefined`. Everything else returns
its answer or throws. `try` is banned outright, and the ban is deliberate - the
lint rule used to demand a `try` prefix and now refuses it, which is why the
message says what to rename to rather than just "no".

The same file gathers the rules about conditions and signatures, because they
fail the reader the same way: the shape on the page does not say what the code
answers with. A four-term boolean, a condition with three property hops and two
calls, a chain hung off an `await`, two overloads differing by a boolean
literal, and a conditional type nested past a few levels are all "the answer is
in here somewhere".

## Decision

A rule lives in the lowest layer that can express it (ADR-135). Everything in
this family needs the AST, so it is the plugin, except the explicit result
type, which `typescript/explicit-module-boundary-types` states natively (ADR-135).

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/fallible-result-naming` | plugin | Only `find*` may answer with absence, and a repository answers `find*` where a service answers `get*` (ADR-146). |
| `langwatch/banned-verb-prefix` | plugin | No `try*` or `require*` name: a value-returning `require` becomes `get`, one that answers nothing (void or asserts) becomes `assert`, a `try` is named for what it answers, and a `try` whose catch answers null loses the catch too. Was the prefix half of `fallible-result-naming` and `no-try-prefix`. |
| `langwatch/condition-shape` | plugin | A test with more calls, logical operators or chained hops than the config allows (2, 3 and 3 workspace-wide), or a ternary inside a test: split into guard clauses or read the parts into named consts. |
| `langwatch/overload-by-literal` | plugin | Two overloads differing only by a literal are two functions. |
| `langwatch/conditional-type-depth` | plugin | A conditional type nested past the allowed depth states the shape instead of computing it. |
| `langwatch/zod-object-composition` | plugin | Compose Zod objects by spreading `.shape`, and use `.safeExtend()` when refinements must survive. |
| `langwatch/zod-internals` | plugin | No `._def` reads and no `instanceof ZodError`: both differ between the two installed Zod majors. |
| `langwatch/refusal-is-a-handled-error` | plugin | A refusal is a thrown `HandledError`, never a hand-rendered error answer. |
| `langwatch/stand-in-cast` | plugin | No cast through `unknown` or `any`. |
| `langwatch/no-runtime-reflection` | plugin | No `Proxy`, `Reflect`, `Object.defineProperty` on a non-prototype, or `Object.setPrototypeOf` standing in for a real type. |

The naming rules report one message id per fix, because the fix differs:
nullable without `find`, service vocabulary on a repository, a `require`
prefix, a `try` prefix, and a `try` that swallows its failure each name their
own rename. `boolean-wall` and `awaited-return-chain` were deleted on
2026-09-23; `condition-shape` covers the first.

## Consequences

The absence contract is readable from the signature alone, which is what makes
"only `find*` returns undefined" enforceable at all: a reviewer checks the
name against the return type and needs nothing else.

The condition rules are the ones most often met with a baseline entry rather
than a fix, and `condition-shape` is one of the ten rules the shrink-only
oxlint baseline carries. That is the intended relationship: the rule holds the
line for new code, the baseline records the debt with a measured date, and the
ledger may only shrink.

`no-try-prefixed-name` was a straight duplicate of `langwatch/fallible-result-naming`'s
`tryPrefix` message id and was deleted per ADR-135's follow-ups, with no
replacement: the enabled plugin rule already carries the check.
