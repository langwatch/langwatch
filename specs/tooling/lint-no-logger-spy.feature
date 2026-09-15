Feature: The no-logger-spy lint rule
  Spying on a real logger patches a method on a shared pino instance for the
  life of the test process; a later test can observe, or fail to observe,
  the spy left behind. `createTestLogger()` gives a throwaway logger a test
  can assert on directly, with no patching.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Spying on an inline createLogger call patches a real logger
    Given a test file that spies on an inline createLogger call
    When the no-logger-spy rule runs over it
    Then it reports spyOnLogger

  @unit
  Scenario: Spying on a logger variable patches a real logger
    Given a test file that spies on a variable assigned from createLogger
    When the no-logger-spy rule runs over it
    Then it reports spyOnLogger

  @unit
  Scenario: Spying on an unrelated object is allowed
    Given a test file that spies on an object unrelated to a logger
    When the no-logger-spy rule runs over it
    Then it reports nothing

  @unit
  Scenario: A logger spy outside a test file is not governed
    Given a non-test file with the same logger spy
    When the no-logger-spy rule runs over it
    Then it reports nothing
