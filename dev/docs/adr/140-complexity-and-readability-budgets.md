# ADR-140: Two complexity metrics, and the budgets that go with them

**Date:** 2026-09-09

**Status:** Proposed

**Behavioural contract:**
[The workspace complexity budget](../../../specs/tooling/lint-complexity-budgets.feature),
[cognitive complexity](../../../specs/tooling/lint-cognitive-complexity.feature),
[comment block size](../../../specs/tooling/lint-comment-block-size.feature),
[the comment block warning tier](../../../specs/tooling/lint-comment-block-size-warning.feature),
[the baseline](../../../specs/tooling/lint-baseline.feature),
[unbounded loops](../../../specs/tooling/lint-unbounded-loop.feature),
[logical statement spacing](../../../specs/tooling/lint-logical-statement-spacing.feature),
[service member spacing](../../../specs/tooling/lint-service-member-spacing.feature),
[statements per line](../../../specs/tooling/lint-max-statements-per-line.feature)

**Related:** [ADR-135: the toolchain](./135-lint-and-format-toolchain.md),
[ADR-137: module source grammar](./137-module-source-grammar.md)

## Context

Cyclomatic complexity counts branches. Cognitive complexity, as SonarSource
defines it, counts what a reader has to hold: a structural point for each
control-flow break, plus the current nesting level for the constructs that
nest, with `else` taking the point without the nesting penalty and a boolean
sequence taking one flat point. They disagree in both directions. A flat
`switch` with twenty cases is cyclomatically appalling and cognitively free;
three nested loops with a condition inside are cyclomatically modest and
unreadable.

Running only the branch counter passes the second function. Running only the
cognitive counter passes the first, and the first is where a missed case hides.
So both run, with different budgets, and the numbers are not comparable: 25
branches beside a cognitive score of 15.

Comments are the other half of the same problem. A comment block that grows
past a handful of lines is almost always one of two things: an incident report
that belongs in an ADR, or a narrative apology for code that should have been
rewritten. Both go stale, and neither is read at the moment it matters.

## Decision

| Rule | Layer | Meaning |
| --- | --- | --- |
| `complexity` | oxlint built-in | Cyclomatic complexity of a function, maximum 25 workspace-wide. Raised to 40 in named directories, off in a few. |
| `langwatch/cognitive-complexity` | plugin | SonarSource cognitive complexity, maximum 15; 40 where the config says so. Reads the baseline. |
| `langwatch/comment-block-size` | plugin | The stated maximum is 5 lines. A block of 9 or more, or a comment line past 100 columns, errors. |
| `langwatch/comment-block-size-warning` | plugin | The 6 to 8 line tier of the same analysis. Warns, and says to put the narrative in an ADR the comment points to. A 4 to 5 line block is queued for review and fails nothing. |
| `no-nested-ternary` | oxlint built-in | A ternary inside another ternary's consequent or alternate. Enabled workspace-wide; does not read the baseline. |
| `langwatch/unbounded-loop` | plugin | `for (;;)` and `while (true)` in strict server source: the exit belongs in the header. |
| `langwatch/logical-statement-spacing` | plugin | One blank line around control flow, around a multi-line statement, and between chain groups. |
| `langwatch/service-member-spacing` | plugin | One blank line between consecutive service methods, constructors and accessors. Fixable. Enabled nowhere today. |
| `langwatch/max-statements-per-line` | plugin | Two statements on one line in a service module. Enabled nowhere today. |
| `service-ceilings` | architecture-enforcer | A service module or method past its line, statement, complexity or line-length ceiling. |

`max-depth` (maximum 4) is enabled the same way, scoped by an `overrides`
block rather than workspace-wide, and carries one baseline entry.

Two of these rules read the shrink-only oxlint baseline directly
(`cognitive-complexity`, `comment-block-size`/`-warning`'s shared analysis).
`nested-ternary` used to be a third: `langwatch/nested-ternary` existed only to
consult the baseline in place of the built-in `no-nested-ternary`, because
oxlint has no baseline mechanism of its own. ADR-135's class-A migration
deleted the plugin rule, re-keyed its 342 baseline entries from
`nested-ternary|` to `no-nested-ternary|`, and joined `no-nested-ternary` to
`max-depth` and `complexity` on the `generate-native-baseline-overrides.mjs`
list: a generated `overrides` block turns the rule off for exactly the 342
baselined files, the same mechanism those two native rules already used, so
the built-in is enabled directly and the entries it reads did not become
2,586 hand-written override paths. Measured after the re-key and the
generated override: nine files fire that neither the baseline nor the
override cover, all nine already failing under the deleted plugin rule before
this migration (the tenth pre-existing failure, in `modules/github`, no
longer reproduces against the current tree). No new debt was introduced by
the move.

The three spacing rules and the statements-per-line rule are not formatting.
oxfmt does not insert or remove blank lines between statements, so nothing else
in the toolchain has an opinion about where the paragraph breaks in a function
go, and a function written as one unbroken block is the readability problem
these rules exist for.

## Consequences

Two complexity numbers in one message stream means a reader has to notice which
rule fired before reacting to the number. That is the price of measuring two
different things, and the message names the rule.

`service-member-spacing` and `max-statements-per-line` are written, tested,
documented in `dev/docs/lint-rules.md`, and enabled in no configuration. They
are inert. ADR-135 records them among the five rules needing a wire-or-delete
decision; this ADR records what they would mean if wired.

`comment-block-size` is enforced against a ratcheted allowlist of roots
(`comment-block-root`, ADR-135), so the existing long blocks are held rather
than deleted, with an expiry per entry.
