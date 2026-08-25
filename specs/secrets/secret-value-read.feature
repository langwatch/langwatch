Feature: A caller that can manage a secret can read its value back
  As a code agent that stores a session token in the project secret store
  I want to read that value again during the run
  So that a row can pick up what another row wrote instead of logging in again

  # Why a value read exists at all: the `secrets` namespace a code block reads
  # is a snapshot taken when the row starts. A row that wants the newest value
  # has to ask for it. Every other secrets route answers with metadata only,
  # so this is the one route that returns a value.
  #
  # It is gated on `secrets:manage`, the write grain, and not on `secrets:view`.
  # A caller that can replace a secret can already learn its next value, so
  # reading the current one grants nothing new. A caller that can only list
  # names is deliberately kept away from the values.
  #
  # Product-owned secrets (the reserved names) are excluded here for the same
  # reason they are excluded from the listing: the customer did not create them
  # and must not read them through this route.

  Background:
    Given a project with an API key that can manage secrets

  # ===========================================================================
  # The value read
  # ===========================================================================

  @integration
  Scenario: A stored secret is read back by its name
    Given the project holds a secret named ACME_SESSION
    When the caller reads the value of ACME_SESSION
    Then the response carries the value that was stored
    And the response carries the time the secret was last updated

  @integration
  Scenario: A name the project does not hold is refused as not found
    Given the project holds no secret named ACME_SESSION
    When the caller reads the value of ACME_SESSION
    Then the request is refused with the secret_not_found code

  @integration
  Scenario: A product-owned secret is refused as not found
    Given the project holds a product-owned secret
    When the caller reads the value of that secret
    Then the request is refused with the secret_not_found code

  @integration
  Scenario: A request without an API key is refused
    Given a request that carries no API key
    When the caller reads the value of ACME_SESSION
    Then the request is refused as unauthenticated

  @integration
  Scenario: A caller that can only view secrets cannot read a value
    Given a caller that holds secrets:view and not secrets:manage
    When the caller reads the value of ACME_SESSION
    Then the request is refused as forbidden

  @unit
  Scenario: A value the platform can no longer decrypt is named as unreadable
    Given a stored secret whose value cannot be decrypted
    When the caller reads the value of that secret
    Then the request is refused with the secret_value_unreadable code
    And the failure is recorded as a platform fault

  # ===========================================================================
  # The SDK surface that code agents use
  # ===========================================================================

  @unit
  Scenario: Storing a secret that does not exist yet creates it
    Given the project holds no secret named ACME_SESSION
    When the agent stores a value under ACME_SESSION
    Then the secret is created with that value

  @unit
  Scenario: Storing a secret that exists replaces its value
    Given the project holds a secret named ACME_SESSION
    When the agent stores a new value under ACME_SESSION
    Then the existing secret is updated and no second secret is created

  @unit
  Scenario: A secret created by a row running beside this one is updated instead
    Given the project holds no secret named ACME_SESSION when the agent starts
    And another row creates ACME_SESSION first
    When the agent stores a value under ACME_SESSION
    Then the create is refused as a conflict and the agent updates the secret

  @unit
  Scenario: Reading a value the project does not hold names the missing secret
    Given the project holds no secret named ACME_SESSION
    When the agent reads the value of ACME_SESSION
    Then the agent is told the secret was not found
