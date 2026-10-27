Feature: Guided onboarding reads and settles the organization's guided state

  @unit
  Scenario: the provider screen offers every live guided provider
    Given the curated guided providers
    When the provider screen lists what it offers
    Then every curated provider that is a live LLM registry entry is offered

  @unit
  Scenario: The kickoff settles its state lines from the durable record before the turn starts
    Given a guided kickoff whose state lines were sent by the browser
    And a durable record of the organization's provider and model
    When the kickoff is settled before the turn starts
    Then its state lines carry the stored facts
    And its brief is rebuilt from them

  @unit
  Scenario: A bound key reads the organization's guided onboarding state
    Given a project API key bound to a user
    When it reads the guided onboarding state
    Then the state is read for the key's organization and user

  @unit
  Scenario: the kickoff greets the reader by their first name
    Given the reader's full name
    When the tour kickoff is written
    Then it greets them by the first word of their name
