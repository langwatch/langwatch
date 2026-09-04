Feature: Generated release notes keep one entry per change
  As a maintainer preparing a release
  I want generated release notes to remain complete and readable
  So that release pull requests can be safely published

  @unit
  Scenario: Duplicate commit entries leave one generated release note
    Given generated release notes contain two entries for the same commit
    When release-note deduplication runs
    Then one entry for that commit remains

  @unit
  Scenario: Duplicate removal preserves following changelog sections
    Given a duplicate entry appears before another changelog section
    When release-note deduplication removes the duplicate
    Then the following changelog section remains

  @unit
  Scenario: Incomplete changelogs remain unchanged
    Given generated release notes have no release section or commit link
    When release-note deduplication runs
    Then the incomplete content remains unchanged

  @unit
  Scenario: An unavailable commit subject does not stop generated release notes
    Given a generated release note references an unavailable commit subject
    When release-note deduplication runs
    Then the remaining generated release notes continue to be processed
