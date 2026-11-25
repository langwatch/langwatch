Feature: Resource detail pattern
  As someone building the page of one record with actions on it
  I want one runnable example of the header, the facts, the snippet and the confirmations
  So that I copy a page that already works, in light and dark

  @integration
  Scenario: Every virtual key story shows its state in light and dark
    Given the named stories of the Resource detail pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, status, dialog or notice

  @integration
  Scenario: The snippet language changes from the keyboard
    Given the usage example showing Python
    When the reader moves to the next language with the arrow key
    Then the TypeScript snippet shows
    And copying copies the TypeScript snippet

  @integration
  Scenario: The snippet never carries the secret
    Given an active key
    Then the page shows the key prefix and reads the secret from an environment variable

  @integration
  Scenario: Disabling and enabling a key changes its status
    Given an active key
    When the reader disables it and confirms
    Then the status reads Disabled and Enable is offered
    When the reader enables it
    Then the status reads Active again

  @integration
  Scenario: Cancelling a revoke keeps the key
    Given the revoke confirmation
    When the reader cancels
    Then the key is still active and the dialog is closed

  @integration
  Scenario: Confirming a revoke ends the key
    Given the revoke confirmation
    When the reader confirms
    Then the status reads Revoked
    And Disable, Enable and Revoke are gone and focus moves to Audit history

  @integration
  Scenario: A missing or failed key leads back to the list
    Given a key that is missing or failed to load
    Then the page offers a link back to the virtual keys
    And a failed load also offers Try again

  @integration
  Scenario: A key without requests explains its empty usage
    Given a key with no usage
    Then the usage card says no requests yet and links to sending a first one

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
