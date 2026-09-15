Feature: The awaited-return-chain lint rule
  A strict feature service returns the awaited value directly instead of
  chaining a property or call off an inline `await` — the awaited result is
  named first so its shape is visible at the call site.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A chained await in a return statement is reported
    Given a service method that returns a property chained off an inline await
    When the awaited-return-chain rule runs over it
    Then it reports awaitedReturnChain

  @unit
  Scenario: A named await before the return is left alone
    Given a service method that names the awaited value before returning from it
    When the awaited-return-chain rule runs over it
    Then it reports nothing
