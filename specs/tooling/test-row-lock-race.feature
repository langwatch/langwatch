Feature: Two writes on one Postgres row are staged, not hoped for
  `@langwatch/test-harness/row-lock-race` runs two writes on one row so the
  second parks on the first's row lock and re-checks its WHERE clause against
  what the first committed. A write is settled when it finishes, whatever it
  returns, so a first write that returns nothing is as legal as one that
  returns a value.

  Rule: the second write parks behind the first and sees what it committed

    @integration
    Scenario: A first write that returns nothing still stages the race
      Given a conditional second write over a row the first write also updates
      When the first write finishes without returning a value
      Then the second write waits for the row lock and re-reads the committed row
      And both writes' answers are handed back

    @integration
    Scenario: A first write's answer is handed back with the second's
      Given a first write that returns a value
      When the race completes
      Then the first write's value and the second write's value are both returned

  Rule: a first write that fails fails the race at once

    @integration
    Scenario: A failing first write is reported as itself
      Given a first write that throws
      When the race runs
      Then it rejects with that error rather than waiting for a lock that never comes
      And the first write's changes are rolled back
