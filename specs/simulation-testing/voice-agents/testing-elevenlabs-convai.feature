Feature: Testing ElevenLabs conversational AI agents
  As a LangWatch user with a voice agent on ElevenLabs
  I want to run simulations against it from scenario authoring
  So that I can test my agent against my own criteria and review every call

  # @see https://github.com/langwatch/langwatch/issues/7978
  #
  # This file is the contract. Everything else is implementation detail.

  Background:
    Given a LangWatch user with a project

  @e2e
  Scenario: Simulate a call against a voice agent reachable through ElevenLabs
    Given the user has a voice agent reachable through ElevenLabs
    When they go to Simulations and author a scenario against that voice agent
    And they provide the criteria the simulation is judged on
    And they run the simulation
    Then a simulated user talks to their voice agent
    And the run is judged against their criteria
    And they can see the results
    And they can see the whole conversation as a transcript
    And they can listen to the whole call
    And they can listen to each part of the conversation
    And they can see the threads and traces for their agent and for the scenario runner
    And the traces carry the audio and they can listen to it there
    And the traces carry all the metadata the call makes available
