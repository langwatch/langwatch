Feature: Prompt service
  Prompt owns versioned prompt configurations and their custom tags.

  Scenario: invalid handles are rejected at the contract boundary
    When a caller creates a prompt with an invalid handle
    Then the Prompt contract rejects the command before persistence

  Scenario: prompt versions remain part of one Prompt service
    Given a prompt has multiple versions
    When a caller requests its versions
    Then the Prompt service returns the version history

  Scenario: existing transports preserve their public surface
    When a caller uses tRPC or the REST prompt API
    Then the request delegates to the process-owned Prompt service
    And the existing procedure names and /api/prompts paths remain unchanged

  Scenario: prompt tags remain subordinate behaviour
    When a caller creates or renames a prompt tag
    Then the Prompt service applies the organization scope
    And no separate tag feature or repository is created

  Scenario: trace metadata uses the Prompt contract
    Given SDK span attributes describe a Prompt handle, version, tag, or variables
    When Trace reads the Prompt metadata
    Then the Prompt contract interprets the attributes consistently
    And Trace retains ownership of locating the reference in a trace
