# ADR-140: cognitive complexity is the one complexity score. The native
# branch counter is off (2026-09-23), so the only budget pinned here is the
# cognitive one; a budget nobody has written down is one the next person rounds up.

Feature: The cognitive complexity budget, declared once
  As a platform maintainer
  I want the cognitive counter's budget pinned in the configuration
  So that nobody quietly rounds it up

  Rule: `langwatch/cognitive-complexity` carries the cognitive budget

    @unit
    Scenario: The cognitive budget is declared workspace-wide at 15
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the cognitive complexity rule is enabled with a maximum of 15
