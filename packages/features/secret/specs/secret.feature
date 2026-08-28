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
    Given a Secret create or update request
    When the handler needs audit attribution
    Then it reads context.actor().id
    And a credential with no user identity receives a handled refusal

  Scenario: Secret values never leave the boundary
    Given a project secret is stored encrypted
    When its metadata is listed or read
    Then the response contains its id, name, project and timestamps
    And the response contains neither its value nor its encrypted value

  Scenario: Product-owned secrets are hidden and immutable
    Given application composition reserves a secret name for another feature
    When a caller lists, reads, updates, deletes, or creates that name
    Then listing omits it
    And direct access does not confirm that it exists
