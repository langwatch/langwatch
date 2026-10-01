Feature: A declaration-file budget per application
  Loading declaration files is the largest bucket in a type-check — larger than
  checking expressions — so the file count is the number that tracks the cost,
  and the number that catches an import nobody meant to make. Each application
  carries a committed budget: today's count with a little headroom. Growing past
  it is a decision somebody writes down, not something that happens quietly.

  @unit
  Scenario: The budget check reads the declaration count out of extended diagnostics
    Given a compiler run that printed its extended diagnostics
    When the budget check reads the count
    Then it takes the number from the Files line, whatever colour codes surround it

  @unit
  Scenario: A run that reported no count is refused rather than read as zero
    Given a compiler run that failed before it printed a Files line
    When the budget check reads the count
    Then it calls the package unmeasured rather than passing it
    And the message names the package and the command that shows what went wrong

  @unit
  Scenario: A package within its declaration budget passes
    Given an application that loads fewer declaration files than its budget
    When the budget check judges it
    Then it passes

  @unit
  Scenario: A package at exactly its declaration budget passes
    Given an application that loads exactly as many declaration files as its budget
    When the budget check judges it
    Then it passes

  @unit
  Scenario: A package over its declaration budget names the growth and the two ways out
    Given an application that loads more declaration files than its budget
    When the budget check judges it
    Then it fails
    And the message states how many files it grew by
    And the message names the compiler flag that finds the new import
    And the message names the file where a raise is recorded

  @unit
  Scenario: Every budget leaves headroom over the count it was measured from
    Given the committed budget file
    When it is read
    Then every application's budget is at least the count it was measured from
    And no budget is more than five percent above that count
