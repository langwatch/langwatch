Feature: Settings page pattern
  As someone building a settings page
  I want one runnable example of saved fields next to switches that apply at once
  So that I copy a page whose two ways of saving are clear, in light and dark

  @integration
  Scenario: Every settings story shows its state in light and dark
    Given the named stories of the Settings page pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, field, message or notice

  @integration
  Scenario: Saving the name stores it and says so
    Given the organization settings with the name changed
    When the reader presses Save changes
    Then the saved name is shown and nothing is marked unsaved
    And a notice says the organization was updated

  @integration
  Scenario: A refused save keeps what was typed
    Given a save that is refused once
    When the reader presses Save changes
    Then the page says the update failed and the typed name is still in the field
    And pressing Save changes again stores it

  @integration
  Scenario: A missing name is said under the field
    Given the organization settings with the name cleared
    When the reader presses Save changes
    Then the name field explains what is wrong and takes focus
    And nothing is stored

  @integration
  Scenario: Live presence saves without the form
    Given the organization settings with a typed, unsaved name
    When the reader flips Live presence
    Then the switch saves on its own and says Saved
    And the unsaved name is neither stored nor lost

  @integration
  Scenario: A refused switch goes back and says why
    Given a switch save that is refused
    When the reader flips Live presence
    Then the switch returns to its previous position and an error says it could not be saved
    And the name form is not submitted

  @integration
  Scenario: Read-only settings are explained, not disabled
    Given someone who cannot change the settings
    When the page is shown
    Then the values are readable text, there is no Save changes button
    And a banner says who can change them

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
