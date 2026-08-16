Feature: Virtual key disable, enable, and expiry
  As a platform operator
  I want a reversible stop on a tenant's key, and a date after which a key
  stops on its own
  So that suspending a customer is instant, un-suspending them is exact, and
  a key handed out for a day does not outlive the day

  # Background
  #
  # DISABLED is a distinct lifecycle state between ACTIVE and the terminal
  # REVOKED. Disabling rejects the key's requests with its own error code
  # (never a generic auth failure, never the revoked error), while
  # everything about the key survives: budgets, scopes, key material, and
  # any rotation grace that was running. Enable restores ACTIVE exactly.
  #
  # Expiry is a fourth stop, and the only one nobody has to press. It is a
  # date on the key, read at resolve time, not a stored status: the key
  # stays ACTIVE in the database and in every wire enum, so extending the
  # date is an ordinary edit and no sweeper has to run for the key to stop.

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

  # ============================================================================
  # Expiry
  # ============================================================================

  @integration
  Scenario: An expired key is rejected with its own error code
    Given the key's expiration date has passed
    When it is resolved for a request
    Then the rejection names the expiry, not a revoked or disabled key
    # The three stops read the same to a caller that only looks at the
    # status code, and they need three different actions: wait for an
    # administrator, mint a new key, or extend a date.

  @integration
  Scenario: A key whose expiration date is still ahead serves normally
    Given the key expires tomorrow
    When it is resolved for a request
    Then the key resolves and serves
    # The check is a comparison against the moment of the request, so the
    # last minute before the date is as good as the first.

  @integration
  Scenario: Extending the date puts an expired key back in service
    Given the key's expiration date has passed
    When the date is moved into the future
    Then the key resolves and serves again
    # This is why expiry stays a date rather than becoming a status: a key
    # handed out for a day is often needed for one more, and the fix is an
    # edit rather than a new secret in somebody's shell history.

  @integration
  Scenario: Clearing the expiration date makes the key permanent again
    Given the key expires tomorrow
    When the expiration date is cleared
    Then the key never expires
    And it resolves and serves

  @integration
  Scenario: Expiry leaves disable and revoke exactly as they were
    Given the key's expiration date has passed
    When its status is read
    Then it is still ACTIVE, and disable and revoke behave as they always did
    # An expired key can be disabled, enabled, edited and revoked. Expiry
    # decides whether it serves, and nothing else about it.

  @integration
  Scenario: An expiration date in the past is refused when it is written
    When a key is saved with an expiration date that has already passed
    Then the save is refused, naming the expiration field
    # Saving a key that is dead on arrival is always a mistake, and the
    # form can say which field to fix while the person is still looking at
    # it.
