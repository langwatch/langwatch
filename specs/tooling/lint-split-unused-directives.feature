Feature: Lint runs as parallel processes and still reports an unused disable once
  Lint runs the native rules, the langwatch plugin and the type-aware rules as separate oxlint
  processes (ADR-150, amendment of 2026-10-05). A disable directive names rules that may live
  in different processes, so no single process can say on its own that a directive is unused.

  @unit
  Scenario: A disable directive is unused only when no lint process used it
    Given a disable directive whose rules are split across the lint processes
    When one process used the directive and another reported it unused
    Then the merged report does not list the directive as unused
    And a directive every process reported unused is listed once

  @unit
  Scenario: A per-rule unused report stands only where no other process used that rule
    Given a directive naming two rules that live in two lint processes
    When one process reports its own rule unused and the other used nothing in the directive
    Then the merged report lists that rule as unused
    And a per-rule report for a rule another process used is dropped
