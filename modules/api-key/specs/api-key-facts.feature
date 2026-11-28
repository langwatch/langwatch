Feature: API key facts for a staff investigation
  A staff ops function asks api-key for every key of one organization: project keys,
  organization keys, personal tokens, CLI login keys, system keys and staff keys, live or
  revoked. Each key is answered as its id, kind, the project it is bound to, its permissions and
  its times. The name, the token, its prefix, the lookup id and the hash never leave the module
  (ADR-202, amendment 2026-11-25).

  @integration
  Scenario: Every key of the organization is answered with its kind
    Given an organization with a service key, an ingestion key, a CLI login key, a staff key and a revoked workflow run key
    When api-key answers the organization's key facts
    Then each key appears once with the kind its stored marks give it
    And live keys come before revoked ones

  @integration
  Scenario: A customer key under a system name keeps its customer kind
    Given a customer key named "Workflow run" that LangWatch did not mint
    When api-key answers the organization's key facts
    Then the key reads as a service key

  @integration
  Scenario: Key facts never carry a name or secret
    When api-key answers the organization's key facts
    Then no answer carries the key's name, lookup id or hash

  @integration
  Scenario: A key bound to one project names it, with its permissions
    Given a key with a custom role on one project
    When api-key answers the organization's key facts
    Then the key names that project and the custom role's permissions

  @integration
  Scenario: Another organization's keys are never answered
    Given a key in another organization
    When api-key answers this organization's key facts
    Then that key is not among them
