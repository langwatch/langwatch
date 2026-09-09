# ADR-139: A name states what a call answers with

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[Fallible result naming](../../../specs/tooling/lint-fallible-result-naming.feature),
[condition shape](../../../specs/tooling/lint-condition-shape.feature),
[boolean wall](../../../specs/tooling/lint-boolean-wall.feature),
[awaited return chain](../../../specs/tooling/lint-awaited-return-chain.feature),
[overload by literal](../../../specs/tooling/lint-overload-by-literal.feature),
[conditional type depth](../../../specs/tooling/lint-conditional-type-depth.feature),
[Zod object composition](../../../specs/tooling/lint-zod-object-composition.feature),
[the ast-grep naming rules](../../../specs/tooling/lint-naming-shapes.feature)

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
this family needs the AST, so it is the plugin, except the four ast-grep rules,
which exist there because CodeRabbit reads them back during review.

| Rule | Layer | Meaning |
| --- | --- | --- |
| `langwatch/fallible-result-naming` | plugin | Every method in a module states an explicit result type; only `find*` may answer with absence; `try` and `require` prefixes are refused by name. |
| `langwatch/condition-shape` | plugin | A condition past 2 property hops, 1 call or 2 logical operators is named before it is tested. |
| `langwatch/boolean-wall` | plugin | More than 3 leaf tests in one condition: group them behind a named const. |
| `langwatch/awaited-return-chain` | plugin | Do not chain properties or calls off an `await`; name the awaited value first. |
| `langwatch/overload-by-literal` | plugin | Two overloads differing only by a literal are two functions. |
| `langwatch/conditional-type-depth` | plugin | A conditional type nested past the allowed depth states the shape instead of computing it. |
| `langwatch/zod-object-composition` | plugin | Compose Zod objects by spreading `.shape`, and use `.safeExtend()` when refinements must survive. |
| `no-identity-function` | ast-grep | A named function that returns its own argument is a name, an import and a call for no behaviour. |
| `require-boolean-name-prefix` | ast-grep | A boolean is named `is` / `has` / `should` / `can` / `will`, or a domain equivalent. |
| `no-try-prefixed-name` | ast-grep | The `try` prefix again, as a review comment. Duplicates `langwatch/fallible-result-naming`'s `tryPrefix`. |

`langwatch/fallible-result-naming` reports four separate message ids rather
than one, because the fix differs: no explicit result type, nullable without
`find`, a `require` prefix, and a `try` prefix each name their own rename.

## Consequences

The absence contract is readable from the signature alone, which is what makes
"only `find*` returns undefined" enforceable at all: a reviewer checks the
name against the return type and needs nothing else.

The condition rules are the ones most often met with a baseline entry rather
than a fix, and `condition-shape` is one of the ten rules the shrink-only
oxlint baseline carries. That is the intended relationship: the rule holds the
line for new code, the baseline records the debt with a measured date, and the
ledger may only shrink.

`no-try-prefixed-name` is a straight duplicate of an enabled plugin rule and is
a deletion candidate recorded in ADR-135. It is kept for now because the
ast-grep rules are what the review bot quotes, and a rule that only fails CI
teaches nobody at the point they wrote the name.
