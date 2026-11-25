Feature: The raw-body-bypass lint rule
  The framework owns request validation. A module's `.withRawBody(...)` names a
  non-JSON `mediaType` and states a `because`, a transport never calls
  `JSON.parse` on a body by hand (a hand-built `hono/http-exception` is
  no-hono-http-exception's). The rule accepts a disable that states
  why the framework cannot express the case.

  @unit
  Scenario: A raw body without a because is reported
    Given a module transport whose withRawBody options give no because
    When the raw-body-bypass rule runs over it
    Then it reports rawBodyBecause

  @unit
  Scenario: A raw body with a because is accepted
    Given a module transport whose withRawBody names a non-JSON media type and gives a because
    When the raw-body-bypass rule runs over it
    Then it reports nothing

  @unit
  Scenario: JSON.parse in a transport is reported
    Given a module transport that calls JSON.parse
    When the raw-body-bypass rule runs over it
    Then it reports jsonParse

  @unit
  Scenario: JSON.parse outside a transport is not this rule's business
    Given a module service that calls JSON.parse
    When the raw-body-bypass rule runs over it
    Then it reports nothing

  @unit
  Scenario: A raw body without a non-JSON media type is reported
    Given a module transport whose withRawBody names no media type, or a JSON one
    When the raw-body-bypass rule runs over it
    Then it reports rawBodyMediaType
