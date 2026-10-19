Feature: Prompt studio compare mode fits the screen
  As a user comparing two prompts
  I want both panes to share the room the studio has
  So that neither pane runs off the edge of the screen

  @integration
  Scenario: Compare mode shares the studio width between its panes
    Given two prompts open side by side in the prompt studio at 1280 pixels wide
    Then both panes sit inside the viewport
    And both panes are the same width
    And the page does not scroll sideways
