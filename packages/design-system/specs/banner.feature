Feature: One banner for page and section messages
  As someone reading a page that needs my attention
  I want every banner to look the same and sit cleanly where it is placed
  So that a status message reads as part of the page, not a floating box

  @integration
  Scenario: A top banner fits the top of the content panel
    Given a banner placed at the top of the page
    Then it is square on its top and right edges
    And only its bottom-left corner is rounded, like the content panel

  @integration
  Scenario: Stacked top banners read as one band
    Given two banners placed at the top of the page, one above the other
    Then only the lower banner's bottom-left corner is rounded

  @integration
  Scenario: An inline banner is a rounded card
    Given a banner placed inside content
    Then every corner is rounded

  @integration
  Scenario: A banner shows its title, text, action and dismiss
    Given a warning banner with a title, a sentence, an action and a dismiss button
    Then the reader sees the title and the sentence
    And the action and the dismiss button are buttons
    And dismissing calls back once

  @integration
  Scenario: An error banner is announced at once, any other politely
    Given an error banner
    Then assistive technology announces it as an alert
    And a warning banner is announced as a status
