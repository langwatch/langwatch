Feature: The no-tautological-assertion lint rule
  `expect(true).toBe(true)` or `expect(x).toEqual(x)` compares a value with
  itself: it stays green through any rewrite of the code it appears to cover.
  Two calls or two property reads can disagree, so an assertion that calls the
  code on both sides is a determinism check and is left alone.

  @unit
  Scenario: An assertion that compares a value with itself is reported
    Given a test asserting a literal, a variable and a plain template against themselves
    When the no-tautological-assertion rule runs over it
    Then it reports assertsItself on each assertion's line

  @unit
  Scenario: A determinism check that calls the code twice is left alone
    Given a test asserting hash(input) against hash(input) and client.teams against client.teams
    When the no-tautological-assertion rule runs over it
    Then it reports nothing
