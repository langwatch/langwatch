Feature: The shared-setup-is-a-hook lint rule
  A `describe` whose sibling `it`/`test` bodies all open with the same three or
  more statements has setup pasted into every test instead of lifted into a
  `beforeEach`, and the paste drifts one body at a time as tests are edited.
  The rule only detects: an automated fixer would need to hoist a shared
  binding that a later statement in the same test still reads, which is not a
  safe mechanical splice, so the message names the shared prefix and leaves
  the hoist to a human.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: sibling tests repeating three setup statements are reported
    Given a test file whose describe has three sibling it blocks that each open
      with the same three statements
    When the shared-setup-is-a-hook rule runs over it
    Then it reports siblingTestsRepeatSetup once, at the describe's title
    And the message states the sibling count and the shared statement count
    And the message tells the reader to move the statements into a beforeEach

  @unit
  Scenario: two shared statements are left alone
    Given a test file whose describe has sibling it blocks that only share
      their first two statements
    When the shared-setup-is-a-hook rule runs over it
    Then it reports nothing

  @unit
  Scenario: a describe with a patterned test is left alone
    Given a test file whose describe has two sibling it blocks sharing a
      three-statement prefix and one sibling written as an it.each
    When the shared-setup-is-a-hook rule runs over it
    Then it reports nothing, because the patterned sibling can't be verified
      against the shared prefix

  @unit
  Scenario: shared setup above an existing beforeEach is still reported
    Given a test file whose describe already has a beforeEach and sibling it
      blocks that still share a three-statement prefix
    When the shared-setup-is-a-hook rule runs over it
    Then it reports siblingTestsRepeatSetup

  @unit
  Scenario: the shared prefix stops at the first assertion
    Given a test file whose sibling it blocks share one setup statement and
      then the same three assertions
    When the shared-setup-is-a-hook rule runs over it
    Then it reports nothing, because an assertion ends the setup
