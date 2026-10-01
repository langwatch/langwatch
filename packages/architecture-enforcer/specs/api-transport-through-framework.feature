# See ../../api/specs/fluent-registration.feature and ../../api/specs/trpc-framework.feature
Feature: API transport is defined through the framework

  Every REST family and every tRPC router is declared through @langwatch/api's
  fluent chains. A door hand-rolled beside them is outside the versioning, the
  capability declarations, the error envelope, the published document, and — on
  the tRPC side — outside the ordering rule that makes the authorization check
  read validated input.

  @unit
  Scenario: A transport file defined through the framework passes
    Given a REST family built with createRestService and a tRPC router built with createTrpcService
    When the transport policy reads them
    Then it reports nothing

  @unit
  Scenario: A REST transport file that hand-rolls its routes is refused
    Given a REST transport file imports hono-openapi's route description or a request validator
    And it constructs an HTTP application of its own
    When the transport policy reads it
    Then each of those is reported with the chain to use instead

  @unit
  Scenario: A tRPC transport file that builds a bare router is refused
    Given a tRPC transport file creates its own root, builds a bare router and declares a parser outside the chain
    When the transport policy reads it
    Then each of those is reported with the chain to use instead

  @unit
  Scenario: A transport file that names the legacy RBAC vocabulary is refused
    Given a transport file imports a role module and gates on a role group
    When the transport policy reads it
    Then both are reported, because access is declared in AuthZ terms through the chain

  @unit
  Scenario: The allowlist reached zero and the policy became a plain refusal
    Given the allowlist of unconverted transport files reached zero and was deleted
    When the transport policy runs
    Then every offending file is refused outright, with no list left to excuse one
