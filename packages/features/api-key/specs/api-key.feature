Feature: API key lifecycle
  Scenario: A minted key can authenticate once
    When a key is created
    Then its plaintext token is returned
    And verification returns the key without exposing its secret

  Scenario: A revoked or expired key cannot authenticate
    When a key is revoked or expires
    Then verification rejects its token

  Scenario: A personal key cannot exceed its owner's live grants
    When a key is created with a project or team binding
    Then every requested permission is checked at that resolved scope
    And a permission outside the owner's ceiling is rejected

  Scenario: A service key without bindings defaults to organization administration
    When an unowned service key is created without bindings
    Then it receives one organization ADMIN binding

  Scenario: A system-managed key is not customer-addressable
    When a customer uses the reserved Langy session name
    Then creation, rename, read and revoke are rejected as not found or reserved

  Scenario: Replacing grants is fail-safe
    When replacement grants are attached
    Then the previous grants are revoked only after the new grants exist
    And a failed grant write leaves the previous access intact

  Scenario: A CLI device login replaces only older keys for that device
    When a CLI login key is minted
    Then older keys for the same user, organization and device are revoked
    And a newer concurrent key is not revoked
