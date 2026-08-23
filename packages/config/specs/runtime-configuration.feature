# See ../adrs/001-shared-runtime-configuration.md

Feature: Shared JavaScript runtime configuration
  As a JavaScript service maintainer
  I want shared configuration mechanics with runtime-owned schemas
  So that processes validate consistently without sharing a global secret bag

  @unit @configuration
  Scenario: A runtime parses only its own schema
    Given a runtime-owned Zod schema and an environment source with unrelated fields
    When RuntimeConfig creates the runtime configuration
    Then declared values are parsed and normalized
    And undeclared values do not cross the configuration boundary

  @unit @configuration
  Scenario: Schema defaults make a local service bootable
    Given a deployable service declares safe local defaults in its Zod schema
    And the corresponding environment values are absent
    When RuntimeConfig creates the service configuration
    Then the declared defaults are returned
    And an unrelated service's missing settings cannot prevent this service from starting

  @unit @configuration
  Scenario: Nested semantic keys derive environment bindings
    Given a service declares rateLimit ttlMs as 15000 and enabled as true
    When the runtime supplies RATE_LIMIT_TTL_MS and RATE_LIMIT_ENABLED
    Then the values are parsed into rateLimit.ttlMs and rateLimit.enabled
    And absent overrides use the inline defaults
    And the compiled Zod schema validates the nested result

  @unit @configuration
  Scenario: Invalid runtime configuration fails before service construction
    Given a required runtime setting has an invalid value
    When RuntimeConfig parses the source
    Then it throws InvalidRuntimeConfigError naming the field and issue code
    And the raw invalid value is not included in the error

  @architecture @configuration
  Scenario: Configuration mechanics do not become a global schema
    Given app, worker, and a standalone service have different requirements
    Then each runtime owns and composes its own Zod schema
    And the shared package reads no process environment itself
    And feature packages receive only narrow typed configuration values
