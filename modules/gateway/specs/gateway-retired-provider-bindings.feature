Feature: Retired gateway provider bindings

  Gateway provider bindings were folded into the model provider in iteration
  110. The four addresses stay served so that a caller still on one is told
  where the capability went, rather than reading a bare not-found that says
  nothing about the move.

  @unit
  Scenario: A caller on a retired provider-binding address is told where it went
    Given a caller holding the gateway provider permissions
    When they list, create, update or disable a provider binding
    Then each address answers gone rather than not found
    And the refusal carries the code the client copy is keyed by

  @unit
  Scenario: Every retired address stays published rather than disappearing
    Given the published gateway management surface
    Then it still declares the four provider-binding addresses
    And each one names the model-provider address that replaced it
