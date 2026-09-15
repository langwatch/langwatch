@unit
Feature: Connected instance ownership
  Connected transports share an authenticated instance claim across replicas.

  Scenario: Competing principals cannot register the same project instance
    Given two principals in the same project choose the same instance ID
    When they register concurrently on separate replicas
    Then exactly one registration succeeds
    And the refused registration leaves the winner's agent and presence unchanged

  Scenario: The owning principal can reconnect an instance
    Given a principal registered a connected instance
    When the same principal reconnects on another replica
    Then registration succeeds with the original agent identity

  Scenario: Instance ownership is independent across projects
    Given a principal registered an instance in one project
    When another principal registers the same instance ID in another project
    Then both instances remain available in their own projects

  Scenario: An HTTP instance token cannot be reused by another principal
    Given a principal registered an HTTP instance
    When another principal in the same project polls with that instance token
    Then the session is refused without changing its presence or pending calls

  Scenario: An expired session cannot overwrite a new instance owner
    Given an instance claim expired after its original session stopped refreshing
    And another principal acquired the instance ID
    When the old session refreshes presence or retires
    Then the old session is refused and the new owner's presence remains unchanged

  Scenario: A session cannot alter calls for agents it did not register
    Given a session shares a call's project and instance ID but not its agent
    When the session attempts to read, acknowledge or answer that call
    Then the call and its delivery result remain unchanged
