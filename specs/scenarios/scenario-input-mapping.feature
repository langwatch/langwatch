Feature: Scenario Input Mapping
  As a user configuring scenario suites,
  I want to map scenario-provided data to agent input fields,
  so that multi-input agents work correctly during scenario execution.

  Background:
    Given a project with scenarios configured

  # --- Schema ---
  #
  # Field mappings travel on the *agent config* (scenarioMappings on CodeAgentData
  # and HttpAgentData) and on the scenario-job payload — not on the suite target
  # schema itself, which only carries {type, referenceId}.

  @unit
  Scenario: Suite target schema accepts all valid target types
    Given a suite target JSON with a valid type and referenceId
    When the suite target schema validates
    Then validation succeeds for "prompt", "http", "code", and "workflow" types

  @unit
  Scenario: Suite target schema allows code agent type
    Given a suite target with type "code" and a referenceId
    Then the suite target schema validates successfully

  @unit
  Scenario: Suite target schema ignores unknown fields for backwards compatibility
    Given a suite target with type "prompt" and a referenceId and no extra fields
    When the suite target schema validates
    Then parsing succeeds

  # --- Pipeline Threading ---

  @unit
  Scenario: fieldMappings threads through scenario job schema
    Given a scenario job payload with scenarioMappings on code-agent adapterData
    When the job schema validates
    Then the scenarioMappings are preserved in the parsed output

  @unit
  Scenario: fieldMappings threads through child process data schema
    Given child process data with scenarioMappings on http-agent adapterData
    When the data schema validates
    Then the scenarioMappings are preserved in the parsed output

  # --- Mapping Resolution ---

  @unit
  Scenario: resolveFieldMappings resolves source mappings from agent input
    Given fieldMappings maps "query" to source "scenario" path ["input"]
    And an agent input with messages containing "Hello world"
    When resolveFieldMappings is called
    Then "query" resolves to "Hello world"

  @unit
  Scenario: resolveFieldMappings resolves messages as JSON string
    Given fieldMappings maps "history" to source "scenario" path ["messages"]
    And an agent input with multiple messages
    When resolveFieldMappings is called
    Then "history" resolves to a JSON string of the messages array

  @unit
  Scenario: resolveFieldMappings resolves threadId
    Given fieldMappings maps "tid" to source "scenario" path ["threadId"]
    And an agent input with threadId "abc-123"
    When resolveFieldMappings is called
    Then "tid" resolves to "abc-123"

  @unit
  Scenario: resolveFieldMappings resolves static values
    Given fieldMappings maps "context" to value "Use the knowledge base"
    When resolveFieldMappings is called
    Then "context" resolves to "Use the knowledge base"

  # --- Code Agent Adapter ---

  @unit
  Scenario: Code agent adapter uses resolved fieldMappings for input assignment
    Given a code agent with inputs "query" and "context"
    And fieldMappings maps "query" to source "scenario" path ["input"]
    And fieldMappings maps "context" to value "Search the knowledge base"
    When the adapter builds the input record from an agent input
    Then "query" receives the scenario message content
    And "context" receives "Search the knowledge base"

  @unit
  Scenario: Code agent adapter falls back to legacy behavior without mappings
    Given a code agent with inputs "query" and "context"
    And no fieldMappings are provided
    When the adapter builds the input record from an agent input
    Then "query" receives the last user message
    And "context" receives ""

  @unit
  Scenario: Code agent adapter ignores mappings for nonexistent inputs
    Given a code agent with inputs "query"
    And fieldMappings maps "query" to source "scenario" path ["input"]
    And fieldMappings maps "deleted_field" to value "stale mapping"
    When the adapter builds the input record from an agent input
    Then "query" receives the scenario message content
    And "deleted_field" is not in the input record

  # --- HTTP Agent Adapter ---

  @unit
  Scenario: HTTP agent adapter uses resolved fieldMappings for template variables
    Given an HTTP agent with body template containing "{{query}}" and "{{context}}"
    And fieldMappings maps "query" to source "scenario" path ["input"]
    And fieldMappings maps "context" to source "scenario" path ["messages"]
    When the adapter builds the request body from an agent input
    Then "query" is resolved to the scenario message content
    And "context" is resolved to the conversation history JSON

  @unit
  Scenario: HTTP agent adapter falls back to legacy behavior without mappings
    Given an HTTP agent with body template containing "{{input}}" and "{{messages}}"
    And no fieldMappings are provided
    When the adapter builds the request body from an agent input
    Then "input" is resolved to the last user message
    And "messages" is resolved to the messages array

  # --- Prompt Adapter ---

  @unit
  Scenario: Prompt adapter does not accept fieldMappings
    Given a prompt target adapter
    When its constructor shape is inspected
    Then the adapter has no "fieldMappings" parameter
    And conversation messages flow through without any mapping step

  # --- Default Mappings ---

  @unit
  Scenario: Single-input agent generates default fieldMappings
    Given an agent with a single input "input"
    When computing default mappings
    Then "input" is mapped to source "scenario" path ["input"]

  @unit
  Scenario: Multi-input agent has no default fieldMappings
    Given an agent with inputs "query" and "context"
    When computing default mappings
    Then no default mappings are generated

  # --- UI ---

  @integration
  Scenario: Scenario Mappings section renders for a multi-input code agent
    Given a ScenarioInputMappingSection for a code agent with inputs "query" and "context"
    When the section renders
    Then a "Scenario Mappings" section header is visible

  @integration
  Scenario: Scenario Mappings section shows a row for each scenario field
    Given a ScenarioInputMappingSection for a code agent
    When the section renders
    Then one row exists for each of "input", "messages", and "threadId"

  @integration
  Scenario: Mapping dropdown offers the agent's inputs as targets
    Given the ScenarioInputMappingSection rendered for a code agent with inputs "query" and "context"
    When the user opens the "input" scenario-field mapping dropdown
    Then "query" is available as a target
    And "context" is available as a target

  @integration
  Scenario: Stored static value renders as read-only text
    Given stored mappings with a type "value" mapping of "Use the KB" for "context"
    When the ScenarioInputMappingSection renders
    Then the text "Use the KB" is visible on the context row

  @integration
  Scenario: HTTP agent editor renders Scenario Mappings section
    Given a new HTTP agent editor drawer is open
    When the editor renders
    Then a "Scenario Mappings" section is visible

  @integration
  Scenario: Selecting an agent input emits a stored-format mapping
    Given the ScenarioInputMappingSection rendered for a code agent with inputs "query" and "context"
    When the user selects "query" from the "input" mapping dropdown
    Then the mapping for "query" is saved as a source mapping at path ["input"]

  # --- Backwards Compatibility ---

  @unit
  Scenario: Existing suites without fieldMappings parse successfully
    Given a stored suite target JSON with type "prompt" and no fieldMappings
    When parsed by the suite target schema
    Then parsing succeeds

  @unit
  Scenario: Adapters use legacy behavior when fieldMappings is undefined
    Given an adapter receives undefined fieldMappings
    When processing an agent input
    Then the adapter uses its original hardcoded input logic
