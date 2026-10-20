Feature: Creating a virtual key never reads as a failed create once the key exists
  The create drawer separates the request that mints a key from what happens
  after it. A refused request keeps the form for another try. A minted key is
  kept in the drawer until it has been handed to the secret reveal, and no
  recovery ever invites the reader to create another key.

  @integration
  Scenario: A refused create leaves the form editable and says it failed
    Given the new virtual key drawer with a name typed
    When the create request is refused
    Then a "Failed to create virtual key" notice is raised
    And the name is still in the form and Create can be pressed again
    And nothing is handed to the secret reveal

  @integration
  Scenario: A minted key whose handoff throws offers Show key, never another create
    Given a create request that succeeds
    When handing the key to the secret reveal throws
    Then the drawer says the virtual key was created but could not be opened
    And the form is locked and Create is disabled
    And the create request was made exactly once

  @integration
  Scenario: Show key hands the same minted key over again
    Given a minted key whose handoff has thrown
    When Show key is pressed and the handoff now works
    Then the secret reveal receives the same id, name, secret and model
    And the drawer closes once and the recovery banner is gone

  @integration
  Scenario: A second handoff failure keeps the recovery open
    Given a minted key whose handoff has thrown
    When Show key is pressed and the handoff throws again
    Then the recovery banner and Show key are still offered

  @integration
  Scenario: Escape and Cancel do not discard a key that is still to be shown
    Given a minted key whose handoff has thrown
    When Escape or Cancel is used
    Then the drawer stays open on the recovery banner

  @integration
  Scenario: A form that will not close after the handoff does not hand the key over again
    Given a minted key handed over successfully
    When closing the form throws
    Then the drawer says the virtual key was created but could not be closed
    And pressing Close closes it without handing the key over a second time

  @integration
  Scenario: A second submit while one is unfinished mints once
    Given a create request that has not answered yet
    When Create is pressed twice
    Then the create request was made exactly once

  @integration
  Scenario: A tour submit after a failed handoff does not mint again
    Given a minted key whose handoff has thrown
    When the guided tour submits the create action again
    Then the create request was made exactly once

  @integration
  Scenario: A failed list refresh does not hold back the minted key
    Given a create request that succeeds
    When the list refresh behind it is rejected
    Then the minted key is still handed to the secret reveal

  @integration
  Scenario: Recovery feedback never carries the secret
    Given a minted key whose handoff has thrown
    Then no notice and no text in the drawer contains the secret

  @integration
  Scenario: A create failure that carries a trace id offers it with the notice
    Given a create request that fails with a response carrying a trace id
    When the notice is presented
    Then it keeps the "Failed to create virtual key" fallback wording
    And its error id is that trace id
    And no internal detail of the failure appears in it

  @integration
  Scenario: A known refusal keeps the registry's guidance and still carries the trace id
    Given a create request refused with a code the presentation registry knows
    When the notice is presented
    Then it reads the registry's wording for that code
    And its error id is the trace id of the response

  @integration
  Scenario: A create that never reached the server shows no error id
    Given a create request that fails because nothing answered
    When the notice is presented
    Then it reads as waiting for the server
    And it carries no error id
