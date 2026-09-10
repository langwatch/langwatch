Feature: Testing voice agents by phone
  As a LangWatch user with a voice agent reachable by phone
  I want to run simulations against it from scenario authoring
  So that I can test my agent against my own criteria and review every call

  # @see https://github.com/langwatch/langwatch/issues/7978
  # @see https://github.com/langwatch/langwatch/issues/8014
  #
  # This file is the contract. Everything else is implementation detail.

  Background:
    Given a LangWatch user with a project

  @e2e @unimplemented
  Scenario: Simulate a call against a voice agent reachable by phone number
    Given the user has a voice agent reachable by a phone number alone
    When they go to Simulations and author a scenario against that voice agent
    And they provide the criteria the simulation is judged on
    And they run the simulation
    Then LangWatch places a call to that phone number
    And a simulated user talks to their voice agent over the phone
    And the run is judged against their criteria
    And they can see the results
    And they can see the whole conversation as a transcript
    And they can listen to the whole call
    And they can listen to each part of the conversation
    And they can see the threads and traces for their agent and for the scenario runner
    And the call is one trace for its whole length
    And the traces carry the audio and they can listen to it there
    And the traces carry all the metadata the call makes available
