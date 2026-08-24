Feature: Canonical project-secret lifecycle

  Scenario: Every transport uses one service
    Given the process has constructed one Secret service
    When tRPC, public RPC, or deprecated REST manages a project secret
    Then the transport calls that service from the App context
    And no transport constructs a Secret repository

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

  Scenario: The modern public API is RPC
    When a client calls a dated or latest secrets RPC operation
    Then it receives the canonical Secret service result
    And the operation appears in RPC discovery and OpenAPI

  Scenario: A multi-project credential chooses an authorized project
    Given a credential can access more than one project
    When it calls a Secret RPC with a projectId in the validated input
    Then project authentication authorizes that exact project before dispatch
    And the handler calls context.app.secrets with that projectId

  Scenario: Writes use the authenticated user actor
    Given a Secret create or update request
    When the handler needs audit attribution
    Then it reads context.actor().id
    And a credential with no user identity receives a handled refusal

  Scenario: The old REST family is deprecated but compatible
    When an existing client calls the unversioned REST secret endpoint
    Then the request still delegates to the canonical Secret service
    And the response carries a deprecation warning
    And the REST operation is absent from newly generated OpenAPI
