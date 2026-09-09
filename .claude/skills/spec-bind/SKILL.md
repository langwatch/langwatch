---
name: spec-bind
description: 'Bind a Gherkin scenario to the test that proves it, so check-feature-parity actually enforces it. Covers where a .feature file may live, which tags make a scenario enforced (@unit, @integration, @e2e, @regression) and which exempt it (@unimplemented), how to write the /** @scenario "<title>" */ annotation, how to read the parity report''s verdict banner rather than a per-file tick, and when LEGACY_INERT and LEGACY_UNBOUND apply. Use whenever someone writes or edits a .feature file, says ''the scenario is unbound'', ''parity is failing'', ''add a spec for this'', ''tag the scenario'', or ships a failure path that has no test.'
user-invocable: true
argument-hint: "<feature file path or scenario title>"
---

# Bind a scenario

An untagged scenario enforces nothing. A tagged scenario with no `@scenario` annotation
fails the run. Both look like coverage in a diff, so do all four steps or none.

## 1. Put the file where the checker looks

`check-feature-parity` walks `specs/`, every `specs/` directory under `packages/`
(discovered, so a module's own `modules/<f>/specs/` counts) and
`sdks/typescript/specs`. A `.feature` file anywhere else is invisible.

Write behaviour from the user's side. `Then the job fails without retry`, never
`Then settings.attempts equals 1`. Name the failure paths as their own scenarios with
the error code they carry.

## 2. Tag it

`BOUND_TAGS` is exactly `@unit`, `@integration`, `@e2e`, `@regression`. Anything else
enforces nothing.

```gherkin
@integration
Scenario: A project member creates a secret
  Given a project the caller may manage
  When they create a secret named MY_SECRET
  Then the secret is stored encrypted and listed without its value

@unit
Scenario: Creating a secret with a taken name is refused
  When they create a secret whose name already exists in the project
  Then the request fails with secret_name_taken
```

`@regression` rides alongside a level tag on a bug fix. `@unimplemented` alongside a level
tag marks a tracked promise and is exempt from binding — it is not a way to skip work you
are doing now.

## 3. Annotate the test

The annotation is the last thing before the `it(` / `test(` / `tester.run(` call, and the
title must match the scenario exactly.

```ts
describe("given a stored secret", () => {
  describe("when the caller reads it", () => {
    /** @scenario "Secret values never leave the boundary" */
    it("returns metadata without the value", async () => {
      /* … */
    });
  });
});
```

- Matching is by title across the scanned test roots; the test need not sit beside the
  feature file.
- A line-comment form (`// @scenario "…"`) and a hash form (`# @scenario "…"`, for bats
  and Python suites) work the same way.
- An annotation naming a scenario that no longer exists is reported as an unknown
  annotation and fails the run. Rename both together.

## 4. Run it and read the verdict, not the tick

```bash
pnpm --filter @langwatch/architecture-lint check:feature-parity
```

Read the banner:

```
✗ THIS RUN FAILS: <reasons>.
  A ✓ below means that feature file is fully bound, not that the run passed.
```

A `✓ all bound` under one `▸` heading is scoped to that one file. `grep -c` undercounts,
because a run can fail on something that belongs to no heading at all. `--json` gives the
machine-readable report.

## The two deny-lists

`LEGACY_UNBOUND` (files with enforced-but-unbound scenarios) and `LEGACY_INERT` (files
with no enforced scenario at all) live in
`packages/architecture-lint/src/check-feature-parity.ts`. They exist to hold migration
debt and **may only shrink**. Never add a file to either to get a run green: tag the
scenarios and bind them. Removing a file from a list, once its scenarios are bound, is
part of the change.

## Prove the binding

A test that passes without the code guards nothing. Once, break the production path the
scenario describes and confirm the bound test fails for the stated reason, then restore
it. If the sabotage matched nothing, say so — an unchanged test result is not evidence.
