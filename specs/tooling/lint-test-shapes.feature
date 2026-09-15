# The ast-grep half of test quality: shapes that report as coverage while
# proving nothing. ADR-142 records why each one is a rule. The rules are
# matched against real code by the ast-grep CI job; this spec is bound to the
# fixture gate, which is what keeps a rule from silently going dead.
# `no-test-without-assertion` and `no-empty-test` used to live here as
# ast-grep rules; ADR-135's class-A migration deleted both. `vitest/expect-expect`
# already covered the same two shapes at its oxlint-default "warn" severity,
# which `pnpm lint:oxlint`'s `--quiet` flag makes invisible, and no baseline
# entries exist for it to re-key -- so no explicit config line was added; the
# built-in keeps running exactly as it already did, advisory-only.

Feature: The linter refuses a test that cannot fail
  As a platform maintainer
  I want the shapes that pass regardless of the code to be named
  So that a green run means the code was exercised

  Background:
    Given the committed ast-grep rules and their fixtures under dev/lint/ast-grep

  Rule: `vitest/expect-expect` refuses a test body with no expect, or an empty one, advisory-only under --quiet

    @unit
    Scenario: The assertion-coverage rule carries no explicit config line
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in vitest/expect-expect rule is not explicitly configured

  Rule: `no-tautological-assertion` refuses an assertion that compares a thing to itself

    @unit
    Scenario: The tautological assertion rule keeps a fixture and says the assertion cannot fail
      Given the no-tautological-assertion rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused assertion and an accepted one
      And the rule's message says the assertion cannot fail

  Rule: `use-action-based-test-name` refuses a test name that hedges with should

    @unit
    Scenario: The action-based name rule keeps a fixture and names the word it refuses
      Given the use-action-based-test-name rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused test name and an accepted one
      And the rule's message names should as the word that removes certainty

  Rule: `require-bdd-describe-context` refuses a nested describe that names a topic

    @unit
    Scenario: The describe context rule keeps a fixture and names the given form
      Given the require-bdd-describe-context rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused describe title and an accepted one
      And the rule's message names the given form a nested describe must take

  Rule: `no-form-watch-in-child` refuses form.watch in a child component

    @unit
    Scenario: The form watch rule keeps a fixture and names the call it refuses
      Given the no-form-watch-in-child rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused child component and an accepted one
      And the rule's message names form.watch as the call a child may not make

  Rule: `no-form-disable-on-isvalid` refuses a submit button disabled by form validity

    @unit
    Scenario: The submit disable rule keeps a fixture and names the in-flight shape
      Given the no-form-disable-on-isvalid rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused disabled prop and an accepted one
      And the rule's message names the pending mutation as the only reason to disable
