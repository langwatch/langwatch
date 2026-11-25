Feature: Guided setup pattern
  As someone building a setup with several dependent choices
  I want one runnable example of the stages, the review and the history
  So that I copy a flow that already works, in light and dark

  @integration
  Scenario: Every guided setup story shows its state in light and dark
    Given the named stories of the Guided setup pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own stage, message, rail state or history rows

  @integration
  Scenario: Continue without a threshold is refused under the field
    Given the setup drawer on Watch with no threshold
    When the reader presses Continue
    Then the threshold field explains what is missing and takes focus
    And the drawer stays on Watch

  @integration
  Scenario: Going back keeps the answers
    Given a threshold typed on Watch and Continue pressed
    When the reader presses Back
    Then the typed threshold is still in the field

  @integration
  Scenario: A stage that cannot be opened stays shut
    Given the setup drawer before the earlier stages are answered
    When the reader clicks a later stage in the rail
    Then the drawer stays where it was and the stage is marked disabled

  @integration
  Scenario: The whole setup works from the keyboard
    Given the setup drawer on Watch
    When the reader types, presses Enter, chooses a destination with the arrow keys and presses Continue
    Then Review shows the chosen destination and the rail returns to an earlier stage

  @integration
  Scenario: With nowhere to deliver, Continue is off and says why
    Given the setup drawer with no delivery destination
    When the reader reaches Delivery
    Then Continue is disabled, the reason is on screen
    And a delivery setting and a prompt for a coding agent are offered

  @integration
  Scenario: Review shows the edited choices
    Given the Review stage of a new automation
    When the reader edits the threshold from Review and returns
    Then Review shows the new threshold and the destination chosen before

  @integration
  Scenario: A test send reports its result
    Given the Review stage and a test send that is refused once
    When the reader sends a test message twice
    Then the first result says the message did not arrive and Create is still available
    And the second says it was sent

  @integration
  Scenario: A missing name is said under the field
    Given the Review stage with the name cleared
    When the reader presses Create automation
    Then the name field explains what is wrong and takes focus
    And nothing is saved

  @integration
  Scenario: A refused save keeps every answer and can be retried
    Given a save that is refused once
    When the reader presses Create automation
    Then the drawer says the save failed and every answer is still there
    And pressing Create automation again adds the automation to the list

  @integration
  Scenario: A saved automation keeps what it watches and changes the rest
    Given a saved automation opened for editing
    When the reader changes the threshold and saves
    Then the watched subject was locked and the list row shows the new threshold

  @integration
  Scenario: Load more adds older firings under the ones shown
    Given the first page of the firing history
    When the reader presses Load more until the end
    Then each page is added below the rows already shown, newest first
    And the action is removed on the last page

  @integration
  Scenario: A repeated firing is shown once
    Given an older page that repeats a firing already shown
    When the reader presses Load more
    Then each firing appears once

  @integration
  Scenario: A failed older page keeps the rows and can be retried
    Given an older page that fails once
    When the reader presses Load more and then Try again
    Then the rows stayed in place and the older page is added

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
