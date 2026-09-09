# The ast-grep half of ADR-141: platform invariants provable from one file,
# written as review-visible rules rather than plugin rules. The rules are
# matched against real code by the ast-grep CI job; this spec is bound to the
# fixture gate, which is what keeps a rule from silently going dead.

Feature: The linter refuses the shapes that break a platform invariant
  As a platform maintainer
  I want each invariant to name the shape it refuses and the fix it offers
  So that a rule cannot rot into a message nobody can act on

  Background:
    Given the committed ast-grep rules and their fixtures under dev/lint/ast-grep

  Rule: `no-inline-dynamic-import` refuses an inline import where a static one belongs

    @unit
    Scenario: The dynamic import rule keeps a fixture and offers the top-level import
      Given the no-inline-dynamic-import rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused inline import and an accepted static one
      And the rule's message offers a top-level import instead

  Rule: `no-localhost-fallback` refuses a localhost default behind a nullish coalesce

    @unit
    Scenario: The localhost fallback rule keeps a fixture and names the env schema
      Given the no-localhost-fallback rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused fallback and an accepted read
      And the rule's message names the Zod env schema as where a required variable is validated

  Rule: `require-fetch-timeout` refuses a fetch that carries no abort signal

    @unit
    Scenario: The fetch timeout rule keeps a fixture and names the signal to pass
      Given the require-fetch-timeout rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused call with no signal and an accepted call with one
      And the rule's message names AbortSignal.timeout

  Rule: `no-export-star-shim` refuses a star re-export

    @unit
    Scenario: The re-export rule keeps a fixture and says to update the consumers
      Given the no-export-star-shim rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused star export and an accepted named one
      And the rule's message calls it a re-export shim

  Rule: `no-double-type-assertion` refuses a cast routed through unknown

    @unit
    Scenario: The double assertion rule keeps a fixture and names the shape it refuses
      Given the no-double-type-assertion rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused double assertion and an accepted single one
      And the rule's message names as unknown as

  Rule: `typescript/no-explicit-any` was measured, not enabled

    @unit
    Scenario: The explicit-any rule is not in the workspace-wide config
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in typescript/no-explicit-any rule is not present

  Rule: `no-clickhouse-env-skip-guard` refuses an inverted skip guard

    @unit
    Scenario: The skip guard rule keeps a fixture and says what the inversion means
      Given the no-clickhouse-env-skip-guard rule and the fixture that pins it
      When the fixture gate reads them
      Then the fixture states a refused guard and an accepted one
      And the rule's message says the inverted guard means always skip
