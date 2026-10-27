Feature: Tabs in different projects stay independent
  As a reader with two tabs open in different projects or organizations
  I want each tab to keep its own scope and title
  So that one tab's work does not make the other flicker

  Every tab shares the browser's storage, where the last organization, team
  and project are remembered for the next visit. Only a new page reads that
  memory; an open tab never follows another tab's write.

  @integration
  Scenario: A write in another tab leaves this tab's remembered scope alone
    Given a tab that read project X as the remembered scope
    When another tab remembers project Y
    Then this tab still reads project X
    And this tab does not render again for that write

  @integration
  Scenario: A write in this tab is still seen by its own readers
    Given a tab that read project X as the remembered scope
    When this tab remembers project Y
    Then its readers read project Y without a reload

  @integration
  Scenario: A new tab opens on the last scope remembered
    Given another tab last remembered project Y
    When a new tab reads the remembered scope
    Then it reads project Y
