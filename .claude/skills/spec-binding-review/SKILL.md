---
name: spec-binding-review
description: "Judge whether a `/** @scenario */` bind proves its scenario: every Then step proven by an assertion; the test at the scenario's level (an @integration composition scenario is proven by booting the composition, not by a unit with fakes); a test of a library instance the test builds proves the library, not the product; one annotation on its own line directly above the test call; a product that disagrees with its scenario is a behaviour question, never a bind and never a wording change. Use when someone says 'review the binds', 'is this bind weak', 'does this test prove the scenario', 'review the parity lane', 'unbind', 'behaviour question', 'the scenario says X but the code does Y', 'retag the scenario', or a diff adds @scenario annotations or level tags."
user-invocable: true
---

# Spec-binding review: does the test prove the scenario?

Feature parity binds every scenario (record §13, Alex, 2026-10-05), and a bind is a claim that the
product does what the scenario says. §13 states the rubric in one paragraph (Alex, 2026-10-05); this
skill keeps the detail and the cases. `check:feature-parity` proves only that a title sits on a test
call. This rubric is the reading it cannot do. Writing the test belongs to the `testing` skill;
this skill judges a bind someone made.

## What the instruments already prove

Do not re-check these; run them and read their banners.

- `pnpm --filter @langwatch/architecture-enforcer check:feature-parity`: the scenario carries
  `@unit`, `@integration`, `@e2e` or `@regression` (`@unimplemented` is skipped), the annotation's
  title equals a scenario title, and a test call follows the annotation. `--json` lists
  `unknownAnnotations`, titles that name no scenario.
- Inside the test, lint: `no-tautological-assertion`, `stand-in-cast`, `no-logger-spy`,
  `unit-test-does-not-render`, `test-description-is-an-action`; policy `default-test-lane`.

The checker does not read assertions, does not compare the tag with the test's level, and does not
know what the test built. Those are the rubric.

## The rubric, per bind

Read the scenario at its line (every Given, When, Then and each And), then the bound test whole,
including what its setup builds.

1. **Every Then is proven by an assertion.** Map each Then and each And after it to an `expect`.
   A Then with none is weak. Half a Then is weak: SCIM's "A removal leaves nothing behind"
   asserted the role-binding half only as a call on a faked grants authority, never as a read
   that finds nothing. An assertion that accepts several answers where the scenario names one is
   weak: governance's row 60 accepted three spellings of "-$12.50" until it was tightened to the
   exact string. That a double was called proves the call, not the outcome, unless the Then is
   the call.
2. **The test is at the scenario's level.** An `@integration` scenario about a composition (a
   process, "composed", "mounted", "at boot", the API or the worker) is proven by booting the
   composition: the installation fixture (`apps/api/src/__tests__/api-installation.fixture.ts`;
   the worker and tasks have their own, record §13) or the `createApp` chain, taught by
   `process-composition`. A unit test that fakes the collaborators is weak: auth rows 86 and 87
   were unbound at review because the tests faked the directory (2026-10-05). A test's level is its
   filename (`testing` skill, "Name the level honestly"). A rendering scenario bound to a test that
   proves only the service's decision is weak too (langy rows 169-172).
3. **A library instance the test builds proves the library.** A test that constructs its own
   Better Auth, router or door with its own options proves upstream behaviour, not LangWatch's
   composition. Auth rows 21-23 lost their annotations at review and stay as an "upstream premise pin",
   unbound (1d74ccd142). A test double that mints its own value (the device-flow test's
   `lw_cli_minted`) proves nothing about the real value's format.
4. **One annotation, on its own line, directly above the test call.** The checker reads the title
   only from the annotation's own line (b05ae63a46) and binds only when a test call follows
   (cb02116fdd: fourteen sat above a `describe`, in a file header or above a multi-line
   `it.each`). One test proving two scenarios carries two annotation lines, stacked.
5. **A product that disagrees with its scenario is a behaviour question.** Never bind it, never
   reword the scenario to fit the code, never change product code in a binding lane. Specs are
   requirements (`CLAUDE.md`, truth order): the coordinator or Alex decides which side moves.
   Example: "A REST request is parsed before its credential is resolved" contradicts the ruled
   authenticate-first door (Alex, 2026-09-30); the API lane listed it rather than binding the
   authenticate-first test to it. When Alex rules, the scenario may stand and the product change
   (SSO activation, 2026-10-05).

## Level tags

A binding lane may add a level tag to an untagged scenario and nothing else in a feature file
(the owned paths of every `.claude/manifests/parity-bind-*.md`). Changing an existing tag to match
the test (`@integration` to `@unit`) changes the requirement, so it goes to the coordinator as a
behaviour question, never into the bind.

## Verdicts

| Verdict              | What happens                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- |
| proven               | keep                                                                                     |
| weak                 | remove the annotation only (the test stays); list the row with the missing Then or level |
| upstream premise pin | remove the annotation; keep the test; say which library behaviour it pins                |
| behaviour question   | unbound; list scenario, product evidence and any ruling                                  |

Report one line per bind:

```text
<feature>:<line> "<title>" -> <test>:<line>  <verdict>  <which Then or which level, one clause>
```

## Traps

- **Trusting the candidate score.** `parity:candidates` ranks a reading order (about 75% have the
  right test in the top three); a high score from another module's test proves nothing.
- **A per-file "all bound".** Read the verdict banner; an untagged file reads `0/0` and green.
- **A test written to what the code does today.** If it asserts the code rather than the scenario,
  it is a pin, not a bind.
- **A new test that hand-makes a Prisma stand-in.** §13 allows only the one typed double in
  `@langwatch/test-harness`; prefer the installation level over memory twins.
- **Rewording a scenario that names a deleted symbol.** Flag the wording; bind only when every Then
  is proven in behaviour terms.

## Links

`dev/docs/ARCHITECTURE.md` §13 · `.claude/skills/core/testing-rules.md` §8 · skills `testing`,
`process-composition`, `architecture-review` · `packages/architecture-enforcer/src/tools/check-feature-parity.ts`.
