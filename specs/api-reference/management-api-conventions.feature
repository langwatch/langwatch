Feature: Management API conventions
  The rules every management endpoint obeys, enforced when the service is
  built rather than in review. See dev/docs/adr/094-rpc-endpoint-naming.md.

  Background:
    Given a management family is built with createManagementService

  Rule: RPC is the only way to add a management endpoint

    The four families that predate ADR-094 keep their resource-REST paths and
    their consumers. The list is closed: a family added after the webhooks
    pilot registers RPC operations only. The framework package still offers
    the verb helpers, because SSE and those four families need them, so the
    refusal lives at the single product caller that every management route
    passes through.

    @unit
    Scenario: A new family may not register a resource-REST route
      Given a family whose name is not one of the four legacy families
      When it registers an endpoint with a resource-REST verb helper
      Then the build fails
      And the refusal names the legacy families it is not one of

    @unit
    Scenario: A new family may register an RPC operation
      Given a family whose name is not one of the four legacy families
      When it registers a dotted resource.verb operation
      Then the build succeeds

  Rule: An endpoint answers one success status

    Reading the handler's return value to choose between 200 and 204 gave a
    single operation two shapes — a body on the request that found something,
    an empty response on the one that did not — and callers, the published
    document and both SDKs each have to pick one. The status is a property of
    the endpoint, decided when it is registered.

    @unit
    Scenario: An output schema that accepts both a value and nothing is refused
      When an endpoint declares an output schema that accepts undefined as well as a value
      Then the build fails
      And the refusal names both statuses the endpoint would move between

    @unit
    Scenario: An endpoint that never sends a body always answers 204
      When an endpoint declares no body
      Then every successful request answers 204 with an empty body

    @unit
    Scenario: An endpoint that declares a body always answers its declared status
      When an endpoint declares a required output schema and a created status
      Then every successful request answers that status with the body
      And a response missing the declared body fails the request rather than downgrading to 204

    @unit
    Scenario: An undeclared payload never reaches the wire
      When a handler returns a value for an endpoint that declared no output schema
      Then the response carries no body
