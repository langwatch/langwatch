Feature: API key create and reveal pattern
  As someone building a screen that creates a credential shown only once
  I want one runnable example of the list, the form, the reveal and the copy
  So that I copy a flow that already works, in light and dark

  @integration
  Scenario: Every API key story shows its state in light and dark
    Given the named stories of the API key create and reveal pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, form, message or reveal

  @integration
  Scenario: Creating a key opens a named reveal with focus inside it
    Given the API key list
    When the reader fills in the form and creates the key
    Then the create form has closed
    And a dialog named Token created is open with focus on Copy API key
    And the list holds the new key's prefix

  @integration
  Scenario: A form with missing choices names them and focuses the first
    Given the create form with nothing filled in
    When the reader presses Create secret key
    Then the name field says what is wrong and takes focus
    And no key is created

  @integration
  Scenario: A missing expiry is a choice the reader must make
    Given the create form with a name and no expiry
    When the reader presses Create secret key
    Then the expiry field asks for a date or No expiration and takes focus

  @integration
  Scenario: A refused create keeps the draft and can be retried
    Given a create that is refused once
    When the reader creates the key
    Then the form says the create failed and keeps what was entered
    And creating again opens the reveal

  @integration
  Scenario: Copying writes the real key and shows only a mask
    Given the reveal for a new key
    When the reader chooses Copy API key
    Then the clipboard receives the whole key
    And the button reads Copied
    And the page never shows the key unmasked

  @integration
  Scenario: Copying a snippet writes the real key inside it
    Given the reveal for a new key
    When the reader copies the .env snippet
    Then the clipboard receives the snippet with the whole key and the project
    And the snippet on screen is masked

  @integration
  Scenario: A refused copy claims nothing and offers manual selection
    Given the reveal for a new key and a clipboard that refuses
    When the reader chooses Copy API key
    Then an error says the copy failed and no success notice appears
    And Select the key shows the key selected for a manual copy

  @integration
  Scenario: Done, Escape and the X all clear the key
    Given the reveal for a new key
    When the reader closes it with Done, with Escape or with the X
    Then the dialog is gone and the page holds no trace of the key
    And the list shows the prefix only
    And opening the create form again starts empty

  @integration
  Scenario: The snippet names the projects the key can reach
    Given a reveal for a key that reaches several, one or no projects
    Then several projects offer a choice, one is named outright and none explains there is no project

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
