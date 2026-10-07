Feature: SCIM folds identity's SSO connection facts into its own connection list

  SCIM no longer asks identity which connections an organization holds. It
  hosts a peer fold over identity's connection facts, folded per connection
  with identity-contract's reducer, into its own ScimSsoConnectionView rows.
  The token page and the reconciliation view read those rows, so they lag
  identity until the fold catches up, and existing connections arrive by a
  projection replay of identity's event log (ARCHITECTURE §9).

  # eventing/scim-sso-connection.projection.ts, eventing/scim-sso-connection.pipeline.ts,
  # services/scim-connections.service.ts, services/scim-reconciliation.service.ts

  @unit
  Scenario: SCIM lists the connections it folded from identity's facts
    Given identity registered an Okta connection for an organization and activated it
    And identity registered another organization's connection
    When SCIM lists the organization's directory connections
    Then it lists the Okta connection, ACTIVE and named by its provider
    And it lists no other organization's connection

  @unit
  Scenario: SCIM's connection list lags identity until the fold catches up
    Given identity registered a connection SCIM's fold has not folded yet
    When SCIM lists the organization's directory connections
    Then the list is empty, and SCIM asked identity nothing

  @unit
  Scenario: A projection replay rebuilds SCIM's connection list from identity's event log
    Given SCIM's peer fold is registered beside identity's connection pipeline
    When a projection replay reads the registered pipelines
    Then it lists SCIM's fold under identity's connection aggregate type
    And folding identity's stored facts rebuilds the connection as live delivery does

  @unit
  Scenario: SCIM reads back every connection state identity's reducer folds
    Given identity's reducer folded a connection through a rejection, an attestation and a ceremony in flight
    And identity's reducer folded a connection whose first fact SCIM saw was not its registration
    When SCIM's store writes each state as JSON and parses it back with identity's state schema
    Then it reads back the state it wrote, field for field
