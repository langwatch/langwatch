# See ../adrs/004-public-rest-v1-and-date-negotiation.md
Feature: Public REST is a first-class API surface

  As an API author
  I want REST to use the same fluent, validated contract as RPC
  So that HTTP source plumbing and version negotiation cannot drift by endpoint

  @typecheck @unit
  Scenario: One schema describes one request
    Given an endpoint declared with get, post, put, patch or delete
    Then its chain offers one withInput and one withOutput
    And it does not offer withParams or withQuery
    And a handler input requires withInput in the editor
    And every endpoint requires withOutput in the editor and at startup

  @validation @unit
  Scenario: The method selects the non-path input source
    Given a complete Zod 4 input object containing path and request fields
    When GET handles the endpoint
    Then request fields come from the query
    When POST, PUT, PATCH or DELETE handles the endpoint
    Then request fields come from the JSON body
    And path fields are merged before the complete input is validated once

  @validation @unit
  Scenario: Output always crosses its schema boundary
    When a handler returns a value rejected by withOutput
    Then the central error middleware returns an internal error
    And a hand-built Response cannot bypass validation

  @versioning @unit
  Scenario: The global and date versions are independent
    Given public REST service thing
    Then its global prefix is /api/v1/thing
    And v2 does not alias v1
    And a registered date or latest may follow the service name

  @versioning @unit
  Scenario: An omitted date version defaults to latest
    When neither the URL nor X-API-Version names a date version
    Then the newest endpoint registration answers
    And the response reports latest

  @versioning @unit
  Scenario: A header can pin the optional date version
    When X-API-Version names a real date and the URL omits it
    Then the latest registration on or before that date answers
    And it is byte-identical to the same endpoint selected by a dated URL

  @versioning @unit
  Scenario: URL and header disagreement fails
    When a dated URL and X-API-Version name different versions
    Then the response is 400 api_version_conflict
    And neither source silently takes precedence

  @versioning @unit
  Scenario: Invalid and unavailable header versions differ
    When X-API-Version is neither latest nor a real calendar date
    Then the response is 400 invalid_api_version
    When it is a date before the service existed
    Then the response is 404

  @openapi @unit
  Scenario: Every supported address is documented
    Then OpenAPI contains the optional-version endpoint, each registered date
      and latest
    And the optional endpoint documents X-API-Version
    And every operation id is unique

  @compatibility @unit
  Scenario: Adoption is opt-in
    Given an existing createService consumer
    Then its registrations and public URLs are unchanged
    And no public REST mount exists until createRestService is used
