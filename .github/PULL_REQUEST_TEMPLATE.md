## Why

<!-- What problem does this solve? Link the issue. A reviewer who hasn't seen the issue should understand the motivation after reading this section. -->

Closes #

## What changed

<!-- Plain-English summary of what you did. Focus on the approach, not a line-by-line diff. Put each choice you made in the Decisions table below. A non-technical teammate should be able to follow this. -->

## Decisions

<!-- One row per real choice you made in this PR. Plain short words: a reader with no context should get each row in one read. "Other options considered" names what you did not pick. Add a row for every choice a reviewer might ask "why this way?" about. Example row: | Retry 3 times, then fail | The API drops about 1 in 100 calls; 3 tries covers it | Retry forever (can hang the job); no retry (users see errors) | -->

| Decision | Why | Other options considered |
| -------- | --- | ------------------------ |
|          |     |                          |

## How it works

<!-- Only if the "what" isn't obvious. Explain the mechanism. The choices and their alternatives go in the Decisions table above. Skip this section for straightforward changes. -->

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
