Feature: A changed provider credential reaches a running gateway

  The gateway does not read provider rows. It holds a materialised bundle per
  virtual key, in memory, and that bundle carries the decrypted credential it
  dispatches with. Rotating a key in the control plane changes a row the
  gateway will not look at again on its own, so something has to tell it.

  A rotation is the moment where that matters most. Either the old key is
  already revoked and every request fails, or it still works and traffic keeps
  flowing through a credential the operator believes is retired.

  Two things carry the change, and they cover different writes.

  The fast path carries an administrator's change within a poll: the next
  request through an affected key already uses the new provider state.

  The backstop bounds every other write. The gateway rechecks a cached bundle
  on a short clock and is told whether what it holds is still current, so a
  change nothing announced is picked up on the next recheck rather than never.
  That covers a seeding script, a migration, or anything else writing straight
  to the row.

  Background:
    Given an organization with a stored provider credential
    And a virtual key whose bundle carries that credential

  @integration
  Scenario: replacing a stored credential tells the gateway to drop its copy
    When an administrator saves a new key on that provider
    Then the next request through that key uses the new credential
    And no request keeps using the credential it replaced

  @integration
  Scenario: disabling a provider tells the gateway to drop its copy
    When an administrator disables that provider
    Then no further request is dispatched through it

  @integration
  Scenario: deleting a provider tells the gateway to drop its copy
    When an administrator deletes that provider
    Then no further request is dispatched through it

  @integration
  Scenario: a credential written straight to the row still moves the version token
    Given the gateway holds the version token the control plane last served
    When the credential is replaced without any change to the virtual key
    Then the version token the control plane serves is a different one
    And a revalidation offering the old token is answered with the new bundle
    And the new bundle carries the replaced credential

  @integration
  Scenario: a scope row written straight to the table moves the version token
    Given a provider the key reaches through an organization scope grant
    When that grant is revoked by a write straight to the scope table
    Then the version token the control plane serves is a different one
    And granting it back moves the token again
    When only the order the providers are tried in changes
    Then the version token moves, because the chain is part of the bundle

  @integration
  Scenario: a key nobody touched keeps its version token
    When nothing about the key or its providers changes
    Then the version token stays the same
    And a revalidation offering it is confirmed rather than answered again

  @integration
  Scenario: a change to the virtual key alone still moves the version token
    When the virtual key's own revision moves
    Then the version token the control plane serves is a different one
