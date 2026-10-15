Feature: A loading button keeps its name
  As someone using a screen reader or a test that finds buttons by name
  I want a button that is saving to still be called what it was called
  So that the one action in flight can be found and heard

  @integration
  Scenario: A loading button is still named by its label
    Given a button labelled Create, with an icon or without
    When it starts loading and when it stops
    Then it is named Create before, during and after
    And it is busy, blocked and shows a spinner only while it loads

  @integration
  Scenario: An explicit name wins over the label while loading
    Given a loading button with an aria-label or an aria-labelledby
    Then its name is the one the caller gave

  @integration
  Scenario: Loading text and a custom spinner keep their meaning
    Given a loading button with loading text, or with a custom spinner
    Then the loading text names it, or the label still does
    And the spinner never adds to the name

  @integration
  Scenario: A loading button cannot be activated again
    Given a loading button inside a form
    When the reader clicks or presses it repeatedly
    Then nothing is clicked and the form is not submitted

  @integration
  Scenario: A button still forwards its ref, submits its form and composes with asChild
    Given a button that is not loading
    Then it hands its element to a ref, submits its form and can render as another element

  @integration
  Scenario: A footer action that is saving keeps the action's label as its name
    Given a dialog footer whose primary action is loading
    Then the button is named by the action's label
