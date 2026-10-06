Feature: A langwatch lint finding prints what, why and fix
  Every `langwatch/*` rule is declared through `defineRule`, and every finding it
  reports prints three parts in order: what is wrong (naming the symbol or path),
  one line of why the shape is wrong, and one imperative fix (ARCHITECTURE.md §17).
  The finding is a prompt to the agent reading it, so the reason travels with it.

  @unit
  Scenario: Every finding prints what, a one-line why and fix
    Given a rule declared with what, why and fix for a message
    When its message is rendered
    Then it reads what, then why, then fix, joined by single spaces

  @unit
  Scenario: A message without a one-line why is refused when the rule is declared
    Given a rule whose message gives no why, an empty why, a why over two lines or a why longer than 120 characters
    When the rule is declared
    Then defineRule throws, naming the rule and the message id
