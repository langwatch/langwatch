Feature: Virtual key disable and enable
  As a platform operator
  I want a reversible stop on a tenant's key
  So that suspending a customer is instant and un-suspending them is exact

  # Background
  #
  # DISABLED is a distinct lifecycle state between ACTIVE and the terminal
  # REVOKED. Disabling rejects the key's requests with its own error code
  # (never a generic auth failure, never the revoked error), while
  # everything about the key survives: budgets, scopes, key material, and
  # any rotation grace that was running. Enable restores ACTIVE exactly.

  Background:
    Given an organization with an active virtual key

  @integration
  Scenario: Disable preserves everything and enable restores it exactly
    Given the key was rotated and its previous secret is inside its grace window
    When the key is disabled and then enabled
    Then the key is active again
    And the previous secret's grace state survived untouched
    And the key's budgets stayed active the whole time
    # Revoke destroys grace state on purpose; disable must not, or a
    # re-enabled tenant mid-rotation would be locked out.

  @integration
  Scenario: A disabled key is rejected with its own error code
    Given the key is disabled
    When it is resolved for a request
    Then the rejection names the disabled state, not a bad credential
    # A suspended tenant must be able to tell "we turned you off" from
    # "your key is wrong"; their tooling branches on the code.

  @integration
  Scenario: Revocation is terminal in both directions
    Given the key is revoked
    When disabling or enabling it is attempted
    Then both are refused
    # DISABLED and REVOKED are independent exits: one is a pause, the
    # other is an ending.

  @unit
  Scenario: Disable and enable propagate through the change feed
    Given the gateway caches the key's bundle
    When the key is disabled or enabled
    Then a change event for that key evicts the cached bundle
    # Propagation is push-based and takes effect in seconds, not a
    # stale-cache minute.
