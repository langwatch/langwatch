Feature: Code, money and dates read the one way
  As someone scanning a LangWatch screen for an id, a cost or a time
  I want each drawn the same way everywhere, whole when I copy it
  So that I never misread a figure or paste half a value

  @integration
  Scenario: A middle cut keeps both ends of an id and copies it whole
    Given an id too long for its box
    When it is drawn with a middle cut
    Then its start and its end stay visible
    And the whole value stays in the page, so a copy takes all of it

  @unit
  Scenario: A path keeps its last segment through a middle cut
    Given a file path too long for its box
    When it is drawn with a middle cut
    Then the file name after the last slash stays whole

  @integration
  Scenario: A diff draws a marker column beside highlighted code
    Given a unified diff
    When it is shown in a code preview with line numbers
    Then each line carries its kind, its old and new numbers and its marker
    And the code itself is shown without the markers

  @unit
  Scenario: Money keeps each currency's own decimals
    Given an amount in yen, dollars and dinar
    When each is formatted
    Then yen shows none, dollars two and dinar three

  @unit
  Scenario: A fraction of a cent never reads as zero
    Given the cost of one model call
    When it is formatted
    Then enough digits show to read it
    And an amount too small to show reads as below a floor

  @unit
  Scenario: A date reads as the display asks
    Given one instant
    When it is drawn as a date, a time, both, a relative age or auto
    Then each label reads that way in the viewer's zone

  @integration
  Scenario: The date hover copies every form on click
    Given a date's hover
    Then it lists the age, the zones, ISO 8601 and Unix milliseconds
    And each row is a button that copies its value
