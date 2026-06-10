Feature: Prompt editor drawer display
  As a user editing a prompt inside the Evaluations V3 drawer
  I want the drawer chrome to stay readable while I scroll
  So that controls and content never visually collide

  Background:
    Given I have an evaluation workbench open
    And I open the prompt editor drawer for a prompt target

  # ============================================================================
  # Sticky header / model selector stacking
  # ============================================================================

  @integration
  Scenario: The model selector header stays opaque above scrolling messages
    Given the prompt has long message content that scrolls
    When I scroll the messages in the drawer
    Then the model selector header keeps a solid background
    And the scrolling message text does not show through or over the header

  # ============================================================================
  # Add logic / Add variable buttons
  # ============================================================================

  @integration
  Scenario: The add-variable and add-logic buttons sit on a solid background
    Given I hover over a message editor that shows the add buttons
    When the "Add logic" and "Add variable" buttons appear
    Then the buttons render on a solid (non-transparent) background
    And the message text behind them does not bleed through the button labels
