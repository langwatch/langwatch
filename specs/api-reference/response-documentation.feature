Feature: A route's published answers come from its declaration

  `withOutput` and `withStatus` are the one place a route names its success
  shape, and the published reference derives the success response from them.
  A docs block may still put better words on an answer — but words are all it
  may need to add: a documented answer that states only its description keeps
  the derived content, so no route restates the schema it already declared.

  @unit
  Scenario: A documented answer with only a description keeps the declared shape
    Given a route that declares its output schema
    And its docs name the success status with a description alone
    When the route's reference documentation is published
    Then the success answer carries the docs' description
    And its content is the schema the declaration produced

  @unit
  Scenario: A documented answer that states content overrides the declared shape
    Given a route that declares its output schema
    And its docs restate the success status with their own content
    When the route's reference documentation is published
    Then the docs' content is what the reference publishes

  # Measured 2026-09-21: 626 of the 659 published operations declared no
  # security of their own and inherited the document's single default,
  # `project_api_key` — so the reference told a client to send a project key
  # to every organization, SCIM and instance-admin route. It also left the
  # API-diff harness no operation an organization key could authenticate,
  # which is why three consecutive runs could not prove that credential
  # survived. The machinery to publish the right scheme already existed;
  # only public and optional routes were reaching it.
  @unit
  Scenario: An operation publishes the scheme its own credential presents
    Given a route behind an organization door
    When the document is written
    Then the operation publishes the organization scheme
    And it does not fall back to the document's default requirement

  @unit
  Scenario: A route's own credential wins over its family's door
    Given a route that raises its own credential inside another family
    When the document is written
    Then the operation publishes the route's scheme, not the family's

  @unit
  Scenario: A public operation publishes no requirement at all
    Given a route declared public
    When the document is written
    Then the operation publishes the empty requirement

  # A create whose body the reference cannot demonstrate is a create nothing
  # can be generated for. Measured 2026-09-21: 11 of the API-diff harness's
  # create probes were refused as invalid and one more by an unexpressed
  # domain rule, and every `{id}` route behind those creates went unprobed as
  # a result — 84 operations both sides serve were never compared.
  @unit
  Scenario: A create whose body a shape alone cannot describe publishes an example
    Given a create whose required combination is a domain rule, not a shape
    When the document is written
    Then the request schema publishes a complete worked example
