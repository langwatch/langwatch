Feature: Extensible metadata on scenario run events
  As a platform integrator
  I want to attach arbitrary metadata to scenario run events
  So that I can pass through custom context without server changes

  Background:
    Given a project with scenarios configured

  @integration
  Scenario: Custom metadata passes through from ingestion to read projection
    Given a SCENARIO_RUN_STARTED event with metadata:
      | name        | Login flow  |
      | description | Tests login |
      | environment | staging     |
      | commit_sha  | abc123      |
    When the event is ingested through the repository
    And I retrieve the scenario run data
    Then the run data metadata contains:
      | name        | Login flow  |
      | description | Tests login |
      | environment | staging     |
      | commit_sha  | abc123      |

  @integration
  Scenario: Events with only name and description remain valid
    Given a SCENARIO_RUN_STARTED event with metadata:
      | name        | Login flow  |
      | description | Tests login |
    When the event is ingested through the repository
    And I retrieve the scenario run data
    Then the run data metadata contains:
      | name        | Login flow  |
      | description | Tests login |

  @integration
  Scenario: Metadata under the langwatch namespace is preserved in projection
    Given a SCENARIO_RUN_STARTED event with metadata:
      | name        | Login flow |
      | langwatch   | {"targetReferenceId": "prompt_abc123", "targetType": "prompt", "simulationSuiteId": "suite_789"} |
    When the event is ingested through the repository
    And I retrieve the scenario run data
    Then the run data metadata.langwatch contains:
      | targetReferenceId | prompt_abc123 |
      | targetType        | prompt        |
      | simulationSuiteId | suite_789     |

  @unit
  Scenario: Event parsing preserves additional metadata fields
    Given a SCENARIO_RUN_STARTED event with extra metadata fields
    When the event is parsed by the discriminated union schema
    Then the extra metadata fields are preserved in the parsed output

  @unit
  Scenario: Event schema validates known fields and preserves custom metadata
    Given a metadata object with known and unknown fields
    When the metadata is validated against the event schema
    Then known fields are validated
    And unknown fields are preserved in the output

  @unit
  Scenario: Storage transform preserves metadata key casing
    Given an event with custom metadata keys in camelCase
    When the event is transformed for Elasticsearch storage
    Then the metadata keys remain in their original casing

  @unit
  Scenario: Elasticsearch round-trip preserves metadata integrity
    Given an event with custom metadata keys
    When the event is transformed to Elasticsearch format and back
    Then the original metadata keys and values are intact

  @unit
  Scenario: Elasticsearch mapping includes langwatch namespace fields
    Given the scenario events Elasticsearch mapping
    Then metadata.langwatch is mapped as an object with dynamic keyword support

  @unit
  Scenario: User metadata fields are not explicitly mapped in Elasticsearch
    Given the scenario events Elasticsearch mapping
    Then user-level metadata fields outside langwatch are not explicitly mapped

  @unit
  Scenario: Langwatch namespace rejects incomplete platform metadata
    Given a SCENARIO_RUN_STARTED event with langwatch metadata missing targetType
    When the event is parsed by the schema
    Then the schema rejects the event with a validation error

  @unit
  Scenario: Langwatch namespace is optional on metadata
    Given a SCENARIO_RUN_STARTED event without langwatch metadata
    When the event is parsed by the schema
    Then the event validates successfully with langwatch undefined
