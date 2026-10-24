## Why

<!-- What problem does this solve? Link the issue. A reviewer who hasn't seen the issue should understand the motivation after reading this section. -->

Closes #

## What changed

<!-- Plain-English summary of what you did. Focus on the approach and key decisions, not a line-by-line diff. A non-technical teammate should be able to follow this. -->

## How it works

<!-- Only if the "what" isn't obvious. Explain the mechanism, trade-offs, or why you chose this approach over alternatives. Skip this section for straightforward changes. -->

## Architecture

### Decisions no check makes

<!-- CI reads the diff and fails on any change no lint rule or enforcer policy decides: a new line in dev/docs/ARCHITECTURE.md, a lint suppression, a new package or module, a rule switched off or dropped from the CI gate. If you are an agent: do not decide these yourself. Ask the human you work for, showing 2 or 3 options with the ARCHITECTURE.md sections and existing patterns behind each. Then add the rule that encodes their answer. One line per decision:
- <the decision>. Options: <A>; <B>. Human chose: <which, and why>. Rule: <path of the rule this PR adds or changes, or none - why no rule can express it>
Write "None" if every choice is decided by a check. -->

### Needs a human look

<!-- Anything unusual, outside the usual patterns, a rule bent, a new shape, or a judgement call a reviewer should check. Also: known limitations, follow-on work, edge cases you deliberately chose not to handle. Write "None" if nothing. -->

## Acceptance criteria

Copy from the issue. Tick each. Link its scenario.

- [ ] AC 1
- [ ] AC 2

## Definition of Done

- [ ] Feature file exists in `specs/**/*.feature` (when behaviour changes)
- [ ] Parity check passes (`check-feature-parity` gate in CI)
- [ ] Tests pass
- [ ] Use-proof embedded in this PR (see `dev/docs/TESTING_PHILOSOPHY.md#use-proof`)
- [ ] Docs updated

See `specs/README.md` for feature file binding.

## Test plan

<!-- How did you verify this works? List the key test scenarios. For bug fixes: what regression test did you add, and does it fail without the fix? -->
