Feature: Trusted proxy client address resolution
  As an authentication boundary behind a trusted ingress
  I need the original client address resolved from the forwarded chain
  So that callers sharing the ingress remain distinguishable

  @unit
  Scenario: A trusted proxy resolves distinct forwarded client addresses
    Given two requests arrive through the same trusted proxy peer
    And each request carries a different valid client address before that peer in its forwarded chain
    When the trusted-proxy client address is resolved for each request
    Then each request resolves to its own forwarded client address
