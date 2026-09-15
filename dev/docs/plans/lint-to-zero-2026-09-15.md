# Lint to zero — drive state, 2026-09-15

**Target, as decided by the user:** every finding to zero, not just the CI gate.
Both halves of `pnpm lint` count: `lint:oxlint` **and** `architecture-enforcer lint`.

## The scoreboard

| | session start | now |
| --- | ---: | ---: |
| oxlint errors | 6,075 | 5,949 |
| oxlint warnings | 17,947 | 6,085 |
| oxlint total | 24,022 | 12,023 |
| architecture-enforcer | 3,137 | 2,761 |
| **true total** | **27,159** | **14,784** |

Typecheck held at its 114-error / 40-file baseline throughout, verified by
comparing error-code distribution and the erroring file set, not just the count.

## What is settled, and must not be relitigated

- **Autofix is exhausted.** `oxlint --fix` clears 0. `--fix-suggestions` clears
  129, of which 10 are harmful: it rewrites `const x = expect(p).rejects…` into
  `const x = await expect(p).rejects…` in 8 files that defer the await on
  purpose (one carries a comment saying so), which hangs the test. The other
  119 landed. Do not re-run the suggestion tier without re-excluding those.
- **`vitest/require-mock-type-parameters` is off** (ADR-142 amendment). 11,741
  findings, no possible codemod, test-only so a baseline and an off switch are
  the same decision.
- **Event sourcing is one folder** (ADR-137 amendment). 259 files, 528 import
  specifiers, `feature-source-layout` 453 → 320.

## The trap that will bite the next rename

Moving a file is also an edit to **every baseline that names it**. The registers
are keyed `rule|path`; a row matching nothing does not announce itself, the rule
just re-reports accepted debt as if it were new. The eventing move appeared to
add 208 findings across six rules. All of it was 325 broken keys. Re-keying and
re-sorting (codepoint order, which the rename had broken) returned every rule to
its prior count.

**Check after any move:** re-key the rows, re-sort, confirm row counts and
zero duplicates, and confirm the per-rule counts returned to where they were.

## Remaining work, largest first

| rule | count | shape of the work |
| --- | ---: | --- |
| `comment-block-size-warning` | 5,212 | prose, see the rate note below |
| `fallible-result-naming` | 1,346 | rename + narrow the catch to the absence case |
| `no-try-prefix` | 757 | same family |
| `package-boundaries` | 434 | real boundary debt |
| `feature-source-layout` | 320 | 173 are `services/` subdirectories |
| `temporal-only` | 381 | |
| `zod-object-composition` | 403 | |
| `service-classes` | 301 | |
| enforcer: `unused-module-export` | 559 | |
| enforcer: `boundary-signature-mirrors` | 282 | |

### The comment-block rate note — read before committing to the 5,212

The budget is 5 lines *including* `/**` and `*/`, so it is **3 content lines**,
about 230 characters. The flagged blocks average nearer 300. This is not
tightening; it is deciding which quarter of the explanation to delete.

Measured on `apps/ui/e2e/langy/local-control-fixture.ts` (the densest file,
20 blocks): 11 blocks took two passes, because a first pass written to "about
five lines" lands on six. What survived is genuinely tighter. What was lost is
precision — "`currentTurnId` can be null a moment before the answer row exists"
became "nulls first"; "ask with `turnId`, which waits for it" lost the waiting
guarantee.

The corpus does not support the rule's premise (ADR-140: a long comment is an
incident report or an apology). Sampling found neither: a data-loss bug with
file:line references, a Postgres lock-contention fix, a Slack `invalid_blocks`
failure mode. 3,154 files carry one each; 2,139 carry exactly one. There are no
generated files and no clusters, so there is no cheap win anywhere in it.

The alternative, refused once by the user and recorded here so it is not
re-proposed without new information: set the max to 8, delete the warn tier,
keep the 9+ error tier (213 real targets). That clears 5,212 by policy.

## Crowded folders the consolidation created

Six `eventing/` folders now exceed the 12-file budget: identity 24, experiment
18, trace 17, scenario 17, governance 15, coding-agent 13. The grammar already
supports the nested form `eventing/<pipeline>/<subject>.<kind>.ts`
(`feature-layout-policy.mjs`), which is the intended escape valve. Two
pre-existing `crowded-folder` baseline rows were re-keyed rather than dropped;
the four new ones are NOT baselined and are reported.

## Next actions

1. Decide the comment tier with the rate note above in hand.
2. Nest the six crowded `eventing/` folders by pipeline.
3. `fallible-result-naming` + `no-try-prefix` (2,103 together, one family):
   a `try*`/nullable-returning name must narrow its catch to the absence case,
   never blanket-catch behind a `find*` name.
