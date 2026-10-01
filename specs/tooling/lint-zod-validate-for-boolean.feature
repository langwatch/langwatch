@adr-139
Feature: A boolean Zod check uses validate
  `.validate()` answers whether a value parses without building the output or
  the error, which `.safeParse(…).success` builds and throws away. On a
  compiled schema the boolean is up to 35x faster.

  Rule: `zod-validate-for-boolean` reports a `.safeParse(…)` result read only
    for its `.success` flag

  @unit
  Scenario: A success-only safeParse is reported with validate as the fix
    Given a file reads `.success` straight off a safeParse call
    When lint runs
    Then zod-validate-for-boolean names `.validate(…)`, or `.validateAsync(…)` for an awaited async parse

  @unit
  Scenario: A safeParse whose data or error is read is left alone
    Given the safeParse result is kept, or its data or error is read
    When lint runs
    Then zod-validate-for-boolean reports nothing

  @unit
  Scenario: Published SDK sources are excluded from the validate check
    Given the file belongs to a published SDK under sdks/
    When lint runs
    Then zod-validate-for-boolean reports nothing
