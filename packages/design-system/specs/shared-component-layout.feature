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

  @integration @browser
  Scenario: The peeking cards of a dark toast stack measure evenly in a real browser
    Given dark mode and four toasts raised in a collapsed stack
    When the stack has settled
    Then the top edges of the front card and the two behind it are one equal step apart
    And every visible card is centred on the front card
    And the count of waiting toasts ends at or above the front card's top edge

  @integration @browser
  Scenario: The marker of a dark segmented control measures evenly in a real browser
    Given dark mode and a segmented control of three options with the middle one selected
    When the marker has settled
    Then it sits inside the control as far from the top edge as from the bottom
    And the options sit as far from the left and right edges as the marker from the top
    And the marker covers the selected option

  @integration @browser
  Scenario: A dark empty state measures as wide as its start-aligned container
    Given dark mode and an empty state inside an 800px column that aligns its children to the start
    When the reader looks at the empty state
    Then it is exactly as wide as the column
    And its title's centre lines up with the column's centre
