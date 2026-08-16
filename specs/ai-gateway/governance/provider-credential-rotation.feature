Feature: A changed provider credential reaches a running gateway

  The gateway does not read provider rows. It holds a materialised bundle per
  virtual key, in memory, and that bundle carries the decrypted credential it
  dispatches with. Rotating a key in the control plane changes a row the
  gateway will not look at again on its own, so something has to tell it.

  A rotation is the moment where that matters most. Either the old key is
  already revoked and every request fails, or it still works and traffic keeps
  flowing through a credential the operator believes is retired.

  Two things carry the change, and they cover different writes.

  The change feed is the fast path. A write through the provider service
  appends MODEL_PROVIDER_UPDATED, the gateway's poller evicts every cached
  bundle holding that provider id, and the next request re-materialises.

  The config version token is the backstop. The gateway revalidates a cached
  bundle on a short clock, and the control plane answers "still current" by
  comparing the token the gateway offers. That token has to move whenever
  anything the bundle is built from moves, or the answer is wrong. It covers
  the writes the change feed never sees: a seeding script, a migration, or
  anything else writing straight to the row.

  Background:
    Given an organization with a stored provider credential
    And a virtual key whose bundle carries that credential

  @integration
  Scenario: replacing a stored credential tells the gateway to drop its copy
    When an administrator saves a new key on that provider
    Then a MODEL_PROVIDER_UPDATED change event names that provider
    And the gateway evicts every cached bundle carrying it

  @integration
  Scenario: disabling a provider tells the gateway to drop its copy
    When an administrator disables that provider
    Then a MODEL_PROVIDER_UPDATED change event names that provider

  @integration
  Scenario: deleting a provider tells the gateway to drop its copy
    When an administrator deletes that provider
    Then a MODEL_PROVIDER_UPDATED change event names that provider

  @integration
  Scenario: a credential written straight to the row still moves the version token
    Given the gateway holds the version token the control plane last served
    When the credential is replaced without any change to the virtual key
    Then the version token the control plane serves is a different one
    And a revalidation offering the old token is answered with the new bundle
    And the new bundle carries the replaced credential

  @integration
  Scenario: a key nobody touched keeps its version token
    When nothing about the key or its providers changes
    Then the version token stays the same
    And a revalidation offering it is confirmed rather than answered again

  @integration
  Scenario: a change to the virtual key alone still moves the version token
    When the virtual key's own revision moves
    Then the version token the control plane serves is a different one
