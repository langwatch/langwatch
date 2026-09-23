# ADR-140: Two complexity metrics, and the budgets that go with them

**Date:** 2026-09-09

**Status:** Proposed. Amended 2026-09-23: one complexity metric, one comment
tier, no baseline, and `@lint-keep` is inert (see the last section).

**Behavioural contract:**
[The workspace complexity budget](../../../specs/tooling/lint-complexity-budgets.feature),
[cognitive complexity](../../../specs/tooling/lint-cognitive-complexity.feature),
[comment block size](../../../specs/tooling/lint-comment-block-size.feature),
[no suppression list](../../../specs/tooling/lint-baseline.feature),
[unbounded loops](../../../specs/tooling/lint-unbounded-loop.feature)

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
| `langwatch/cognitive-complexity` | plugin | SonarSource cognitive complexity, maximum 15; 25 in `.tsx`, 40 in tests. |
| `langwatch/comment-block-size` | plugin | A comment block of more than 5 lines, or a comment line past 100 columns, errors. |
| `no-nested-ternary` | oxlint built-in | A ternary inside another ternary's consequent or alternate. Enabled workspace-wide. |
| `langwatch/unbounded-loop` | plugin | `for (;;)` and `while (true)` in strict server source: the exit belongs in the header. |
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

## Amendment, 2026-09-15: `@lint-keep`, and why it is deliberately expensive

The two tiers were being read as one rule with one number, so a sweep that cut
every block to 7 lines cleared 743 errors and created 743 warnings in their
place. The tiers now say what they are, and they answer different questions.

**The error tier cannot be argued with.** At 9 lines or more, or past 100
columns, there is no annotation, no allowlist entry and no escape: the block is
cut. The message says so, rather than leaving a reader to discover it.

**The warning tier can be kept, and almost never should be.** A 6 to 8 line
block has three possible answers, in this order: delete it when the code
already says it; move the narrative into an ADR or a `dev/docs/best_practices/`
page and leave one line linking it; or — rarely — keep it where it is.

The third answer is spelled `@lint-keep <reason> dev/docs/adr/<file>.md` on its
own line inside the block. It requires **both** a reason of at least three
words **and** a path to the ADR or best-practices page that records the
narrative. That is the point of the design: a kept block is not an exception to
"the narrative lives in an ADR", it is the fragment of an already-written ADR
that a reader needs at the code itself — a state table, an ordering constraint,
a wire format. Keeping a block therefore costs writing the document first,
which is what stops the annotation becoming a silencer.

Two consequences worth stating, because both were bugs in the first draft:

- The annotation's own lines do not count toward the block's length. Without
  that, annotating an 8-line block would push it to 9 and into the error tier,
  where the annotation is refused — the fix would cause the failure.
- A `@scenario` line is measured by neither limit. The block limit already
  exempted it; the column limit did not, which made 483 findings across 266
  files into errors with no legal fix — the title is quoted verbatim from its
  spec, so rewrapping it unbinds the test from the scenario it proves. An
  error the reader cannot fix teaches them to ignore the rule.
- Structural JSDoc tags are not commentary and are not counted. One `@param`
  per parameter plus a `@returns` puts a three-argument method at six lines
  before a word of prose, so the house rule requiring those tags on an exported
  symbol and this rule forbidding the length contradicted each other. 281
  blocks across 221 files were caught in that contradiction; 190 others stay
  over the limit on prose alone, which is the part worth cutting. `@deprecated`
  and `@example` are excluded from the discount: those carry prose.
- The message says all this in two sentences and links here for the rest, which
  is the rule's own instruction applied to itself: at 6,466 warnings a
  600-character explanation repeated per finding is the wall the limit exists to
  prevent. Working practice that does not belong in a lint line: more than one
  block in a file is a sweep rather than an edit — list them all with
  `pnpm exec oxlint --config .oxlintrc.architecture.json <file>` and rewrite
  them in one pass.
- A `// oxlint-disable-next-line` comment is **not** a way to silence either
  tier. It is contiguous with the block, so it merges into it and makes it one
  line longer, it does not suppress a report anchored at the block's first
  line, and its own length trips the 100-column error.

## Amendment, 2026-09-15: complexity is attributed to a block, not to a leaf

`cognitive-complexity` reported the score and then named "the heaviest
contributor", picked as the single AST node with the largest delta. That is the
wrong question, and it answered badly in exactly the case the rule exists for.

A function whose score is nesting spread thin has many nodes tied at the top
delta, and the tie broke on walk order — first one wins. A device-flow poll loop
scoring 25 was reported against a `spent ? null : approval` ternary worth 3,
with the fix "extract that ternary expression into its own named function": an
extraction that removes 3 of 25 and leaves the shape untouched. The if/else
chain worth 11 and the catch block worth 11 went unmentioned.

Score is now accumulated per block — each nesting construct carries what its
whole subtree contributed, an `else if` continuing the chain its head opened
rather than starting one of its own — and the report names the block with the
largest share, printing the share so the reader can judge it. Two guards follow
from that:

- A block accounting for the **entire** score is never named. It contains every
  other construct, so extracting it only renames the function.
- When even the largest block carries less than a third, there is no target to
  name, and inventing one prescribes a refactor that will not pay. The rule
  reports `tooComplexSpread` instead, says how many blocks the score is spread
  across, and asks for the nesting to come down rather than for an extraction.

The poll loop now reads: complexity 25, the if/else chain at line 345 carries 11
of it — which is both true and actionable.

## Amendment, 2026-09-23: one metric, one tier, nothing to keep

The lint review of 2026-09-23 deleted the parts of this record that no longer
describe the tree:

- **Native `complexity` is off.** Cognitive complexity is the one score; the
  branch counter's budget of 25 and its overrides are gone.
- **The comment warning tier is gone.** `comment-block-size-warning` and the
  4 to 5 line review tier were deleted; a block of 6 lines or more is an error.
- **`@lint-keep` is inert.** Nothing in the plugin reads it, so the 2026-09-15
  amendment above describes an annotation that silences nothing. A long block
  is cut or moved to an ADR; there is no third answer.
- **No rule reads a baseline.** The ledger, the generated overrides and the
  `comment-block-root` allowlist are deleted (ADR-135).
- **The spacing rules are deleted.** `logical-statement-spacing`,
  `service-member-spacing` and `max-statements-per-line` were removed from the
  plugin.
