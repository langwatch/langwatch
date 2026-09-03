Feature: Prompt service
  Prompt owns versioned prompt configurations and their custom tags.

  @unit
  Scenario: invalid handles are rejected at the contract boundary
    When a caller creates a prompt with an invalid handle
    Then the Prompt contract rejects the command before persistence

  @integration
  Scenario: prompt versions remain part of one Prompt service
    Given a prompt has multiple versions
    When a caller requests its versions
    Then the Prompt service returns the version history

  @integration
  Scenario: existing transports preserve their public surface
    When a caller uses tRPC or the REST prompt API
    Then the request delegates to the process-owned Prompt service
    And the existing procedure names and /api/prompts paths remain unchanged

  @unit
  Scenario: prompt tags remain subordinate behaviour
    When a caller creates or renames a prompt tag
    Then the Prompt service applies the organization scope
    And no separate tag feature or repository is created

  @unit
  Scenario: trace metadata uses the Prompt contract
    Given SDK span attributes describe a Prompt handle, version, tag, or variables
    When Trace reads the Prompt metadata
    Then the Prompt contract interprets the attributes consistently
    And Trace retains ownership of locating the reference in a trace

  @integration
  Scenario: A rejected version write leaves the prompt on its last good version
    Given a prompt whose only version is the one it was created with
    When a new version is written for an author the database does not hold
    Then the write is rejected
    And the prompt still reads back at the version and text it already had

  @unit
  Scenario: Prompt Studio persists its open tabs through the storage it is handed
    Given the application hands Prompt Studio a key-value store of its own
    When a person opens a prompt tab, edits it and closes it
    Then every read and write goes to the store the application handed it
    And Prompt Studio touches no browser storage of its own
