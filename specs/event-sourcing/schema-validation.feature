@unit
Feature: Validation is compiled where it can be, and honest where it cannot

  Validation sits on every hot path this package has: every stored fold state
  is decoded before a fold ever sees it, and every event payload is checked
  before it is applied. Paying that cost with a tree-walking interpreter on the
  busiest streams is a real tax, so the package validates through one seam
  that compiles a schema once and reuses the result, falling back to
  interpreted validation only for the shapes a compiled backend cannot yet
  express.

  A fallback that runs correctly but goes unrecorded is worse than one that is
  merely slow: it hides exactly the gap a dashboard needs to show before
  anyone decides whether closing it is worth the effort. So a schema that
  takes the fallback path has that fact recorded once, at compile time,
  against a metric naming the reason — never once per call, and never
  silently. (ADR-105.)

  Background:
    Given a schema declared for a stored state or an event payload

  Scenario: a value matching the schema is recognised on the hot path
    When a value that matches the schema is checked on the hot path
    Then it is recognised as valid

  Scenario: a value that violates the schema is rejected, not silently coerced
    When a value that violates the schema is checked on the hot path
    Then it is rejected outright
    And nothing is coerced into a value that merely resembles the schema

  Scenario: safeParse classifies without throwing
    When a value that fails the schema is checked through the classifying path
    Then the check reports failure
    And no exception is thrown

  Scenario: safeParse hands back the parsed value on success
    When a value that satisfies the schema is checked through the classifying path
    Then the check reports success together with the parsed value

  Scenario: parse applies the schema's coercion, not just its shape check
    Given a schema that declares a coercion from one shape into another
    When a value in the coercible shape is parsed at a boundary
    Then it comes back coerced into the schema's declared shape

  Scenario: parse still throws at a boundary that has not caught it
    Given a schema that declares a coercion from one shape into another
    When a value that coercion cannot rescue is parsed at a boundary
    Then the parse throws

  Scenario: compiling is memoised, not repeated per call
    Given a schema compiled once
    When the same schema is compiled again
    Then the second compile reuses the first result rather than doing the work again

  Scenario: the cache is keyed by identity, not by shape
    Given two separately declared schemas that describe the identical shape
    When each is compiled
    Then each is compiled independently of the other
    And neither reuses the other's cached result

  Scenario: an unsupported schema still validates correctly through the fallback
    Given a schema that uses a feature the eventual compiled backend cannot handle
    When a value is checked against it
    Then it is still validated correctly, through the fallback

  Scenario: the fallback is recorded rather than degrading silently
    Given a schema that must take the fallback path
    When it is compiled
    Then the fallback is recorded against a metric naming the reason
    And the gap does not pass unnoticed

  Scenario: the fallback metric fires once per schema, not once per call
    Given a schema compiled once
    When it is compiled again for the same schema object, repeatedly
    Then the fallback is recorded only on the first compile
    And later compiles of the same schema do not record it again

  Scenario: the compiled path and interpreted zod accept and reject the same values
    Given a schema and a value
    When the compiled path and plain interpreted validation are both asked about it
    Then they agree on whether it is valid
    And they agree for values that are invalid as well as valid

  Scenario: the helper runs each callback once per warm-up and once per measured iteration
    Given a compiled path and an interpreted path for the same schema
    When the two are timed over a declared number of iterations
    Then each path is exercised once to warm it and once for every measured run
    And the measurement excludes the warm-up

  Scenario: the warm-up is bounded so a large benchmark does not double its own cost
    Given a benchmark asking for far more iterations than the warm-up needs
    When the two paths are timed
    Then the warm-up stops at its own ceiling rather than matching the request

  Scenario: a supported schema never records a fallback
    Given a schema the compiler can handle
    When it is compiled
    Then no fallback is recorded for it
