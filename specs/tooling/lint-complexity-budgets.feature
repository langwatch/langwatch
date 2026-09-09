# ADR-140: two complexity metrics run side by side with different budgets,
# and the two numbers are not comparable. A budget nobody has written down is
# a budget the next person rounds up, so both are pinned here.

Feature: Two complexity budgets, declared once each
  As a platform maintainer
  I want the branch counter and the cognitive counter to keep their own budgets
  So that neither metric quietly inherits the other's number

  Rule: `complexity` carries the workspace cyclomatic budget

    @unit
    Scenario: The cyclomatic budget is declared workspace-wide at 25
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in complexity rule is enabled with a maximum of 25

  Rule: `langwatch/cognitive-complexity` carries the cognitive budget

    @unit
    Scenario: The cognitive budget is declared workspace-wide at 15
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the cognitive complexity rule is enabled with a maximum of 15
