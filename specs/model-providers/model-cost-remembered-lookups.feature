@unit
Feature: Model price lookups are remembered per cost list
  Matching a span's model name against a cost list scans every pricing pattern.
  Each cost list remembers the rate (or the miss) it found for a model name, so
  a repeated name is answered without scanning. A cost list never changes once
  passed in: a changed price is a new list, which starts with nothing remembered.

  Scenario: A remembered lookup picks the same rate as a full scan
    Given the full model catalogue, alone or behind a project's custom rules
    When every known model name is looked up twice
    Then each lookup picks the same rate a full scan of that list picks, misses included

  Scenario: A changed price list is matched afresh
    Given a model name that missed in one cost list
    When a new cost list with a rule for it is passed in
    Then the new rule is found
    And the same name in different lists answers from each list's own rates

  Scenario: A cost list past its memory limit still answers like a full scan
    Given more distinct model names than one list remembers
    When each is looked up
    Then every answer matches a full scan

  Scenario: A repeated lookup does not scan the patterns again
    Given a model name already looked up in a cost list, as a hit or as a miss
    When it is looked up again in the same list
    Then no pricing pattern is evaluated again

  Scenario: A full list forgets the name used longest ago
    Given a cost list that remembers as many names as it can
    And one name looked up again and again, another not since it was first remembered
    When a burst of new names is looked up
    Then the name still in use is answered from memory
    And the name not used since is scanned again

  Scenario: A very long model name is matched but never remembered
    Given a span model name longer than a cost list remembers
    When it is looked up twice
    Then each lookup scans the patterns and picks the same rate
