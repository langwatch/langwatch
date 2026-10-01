@integration
Feature: Canonical project-secret lifecycle

  Scenario: Every transport uses one service
    Given the process has constructed one Secret service
    When app tRPC or modern REST manages a project secret
    Then the transport calls that service from the App context
    And no transport constructs a Secret repository

  Scenario: The modern public API is validated REST
    When a client calls the collection or item route below /api/v1/secret, /api/v1/secrets, or /api/secret
    And it selects `latest` by omitting the version or sends X-API-Version to select v1
    Then the request input is validated by its Zod 4 contract
    And the response is validated by its Zod 4 contract
    And the endpoint delegates to the canonical Secret service
    And it is not cached and explicitly opts out of generic rate and resource limits
    And its remaining bounds are the input-size ceiling and 50 secrets per project

  Scenario: Legacy REST remains a thin compatibility transport
    When a released client calls the old unversioned REST family
    Then the compatibility transport delegates to the canonical Secret service
    And its existing URL, request, response, auth, and deprecation behaviour are the compatibility target
    And known actor-attribution and duplicate-message parity gaps remain in the review ledger
    And generated OpenAPI publishes the legacy REST family and all three modern REST prefixes
    And no public RPC route exists below /api/secrets/{version}/secrets.*

  Scenario: An authorised credential chooses a project
    Given a credential can access more than one project
    When it calls modern REST with a projectId in the validated input
    Then transport authorisation checks that exact project before dispatch
    And the handler calls the service with that projectId

  Scenario: Writes use the authenticated user actor
    Given a Secret create or update request from a credential bound to a user
    When the handler needs audit attribution
    Then the write is attributed to that user

  Scenario: A key bound to no user writes as the first member of the project's team
    Given a legacy project API key, bound to no user
    And the project's team has members
    When it creates or replaces a project secret
    Then the write succeeds as it did on main
    And it is attributed to the first member bound to the project's team

  Scenario: A key bound to no user is refused when the project's team has no member
    Given a legacy project API key, bound to no user
    And nobody is bound to the project's team
    When it creates or replaces a project secret
    Then it is refused with the handled code authenticated_actor_required
    And no secret is written

  Scenario: Secret values never leave the boundary
    Given a project secret is stored encrypted
    When its metadata is listed or read
    Then the response contains its id, name, project and timestamps
    And the response contains neither its value nor its encrypted value

  Scenario: One at-rest format for every process
    Given a project secret encrypted and stored by one LangWatch process
    When a different process reads that row under the same key
    Then it recovers the stored value unchanged
    And a value that process writes back is readable by the first

  Scenario: A key that is not the key refuses rather than guesses
    Given a stored secret encrypted under one key
    When a process reads it under a different key, or the row has been altered
    Then the read fails and no partial value is returned
    And a key that is not a 32-byte hex string is refused when the process composes, not when a customer reads

  Scenario: A process with no key composes no secret service
    Given a process configured with no stored-secret key, or no database
    When it composes
    Then it names the absence at boot
    And it mounts no secret transport, rather than one that fails on every request
    And a host that already owns a secret service can still supply one

  @unit
  Scenario: The feature that owns a reserved name stores its credential once
    Given application composition reserves a secret name for another feature
    When that feature stores its credential under the name
    Then the value is stored encrypted, attributed to the actor it names, outside the project limit
    And a writer that raced it is answered with the value stored first
    And a name that is not reserved is refused without a write

  Scenario: Product-owned secrets are hidden and immutable
    Given application composition reserves a secret name for another feature
    When a caller lists, reads, updates, deletes, or creates that name
    Then listing omits it
    And direct access does not confirm that it exists

  @unit
  Scenario: A secret minted from an HTTP credential keeps the address it was saved for
    Given a feature stores a credential as a project secret for one address
    When the secret is listed, or its value is later replaced without naming an address
    Then its metadata names that address
    And a secret created from the secrets screen names no address
