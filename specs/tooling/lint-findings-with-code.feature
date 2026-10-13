Feature: A lint lane reads its findings with the code they point at
  Lint-fix lanes ran oxlint, then dumped each flagged file whole to see the code,
  one tool call per file. Across 50 lanes on 2026-09-23 those dumps were the
  largest thing in their context, and every later call re-read them.
  `node dev/scripts/lint-findings.mjs <file-list>` prints each finding beside a
  few lines of the code it names, so one call replaces the dumps.

  @unit
  Scenario: Each finding prints its rule, line, fix and the code around it
    Given a finding of rule "langwatch(no-inline-dynamic-import)" at line 24 of a file
    When the findings are rendered with 2 lines of context
    Then the output names "langwatch/no-inline-dynamic-import" at "L24" with its message
    And it shows lines 22 to 26 of that file, line 24 marked

  @unit
  Scenario: Findings close together in one file share one excerpt
    Given two findings in the same file at lines 10 and 12
    When the findings are rendered with 2 lines of context
    Then lines 8 to 14 print once, not twice

  @unit
  Scenario: The summary counts every finding per rule, before any cap
    Given 5 findings of one rule and 1 of another
    When the findings are rendered with a cap of 2
    Then the summary reads 6 findings with both per-rule counts
    And the output says how many findings the cap left out

  @unit
  Scenario: A rule filter keeps only the named rules
    Given findings of two rules
    When the findings are rendered filtered to one of them
    Then only that rule's findings and count appear
