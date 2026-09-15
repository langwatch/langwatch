Feature: The max-statements-per-line lint rule
  A strict feature service block cannot place more than one statement on a
  single physical line — the second statement is reported with the line
  number it shares.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: Two statements on one line are reported with the line number
    Given a service method with two statements on the same physical line
    When the max-statements-per-line rule runs over it
    Then it reports maxStatementsPerLine naming the shared line

  @unit
  Scenario: One statement per line is left alone
    Given a service method with one statement per physical line
    When the max-statements-per-line rule runs over it
    Then it reports nothing
