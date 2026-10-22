Feature: Search metadata matches the published documentation
  Page titles keep the format readers and search engines already know, and descriptions fit a search result.

  @unit
  Scenario: Page titles keep the published format
    Given a guide called "Quick Start"
    When its head is generated
    Then the title, social title and structured name follow the published format
    And the structured name has no site suffix

  @unit
  Scenario: Long descriptions are cut at a boundary
    Given a page whose description is longer than 160 characters
    When its head is generated
    Then the description ends at a full sentence or a whole word within 160 characters
    And it has no ellipsis and is the same in every place the head repeats it

  @unit
  Scenario: Short descriptions stay as authored
    Given a page whose description is shorter than 50 characters
    When its head is generated
    Then the description is unchanged
