Feature: Shared components sit cleanly on the page
  As someone reading a LangWatch page in light or dark mode
  I want stacked toasts, segmented controls and empty states to line up evenly
  So that nothing looks misaligned or collides with its neighbour

  @integration
  Scenario: Cards behind the front toast peek out in even steps
    Given a collapsed stack of three toasts
    When the reader looks at the cards behind the front one
    Then each card peeks out one equal step above the card in front of it
    And each card shrinks evenly about its centre line
    And only the front card shows its text

  @integration
  Scenario: The count of waiting toasts clears the front card's edge
    Given more toasts are raised than the stack shows
    When the reader looks at the front card
    Then the count sits above the front card's top border, not across it

  @integration
  Scenario: The selected segment sits evenly inside the segmented control
    Given a segmented control with a selected option
    When the reader looks at the control
    Then the raised marker is inset by the same amount on every side
    And the marker and the options share one corner radius
    And the selected option's label is shown

  @integration
  Scenario: An empty state fills the width of its container with centred text
    Given an empty state inside a container that aligns its children to the start
    When the reader looks at the empty state
    Then it stretches across the container's full width
    And its title and description are centred
