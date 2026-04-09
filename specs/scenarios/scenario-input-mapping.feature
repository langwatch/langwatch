Feature: Scenario Input Mapping
  As a user configuring scenario suites,
  I want to map scenario-provided data to agent input fields,
  so that multi-input agents work correctly during scenario execution.

  Background:
    Given a project with scenarios configured

  # --- Schema ---

  @unit
  Scenario: Suite target schema accepts fieldMappings
    Given a suite target with type "code" and a referenceId
    When fieldMappings maps "query" to source "scenario" path ["input"]
    And fieldMappings maps "context" to value "Use the KB"
    Then the suite target schema validates successfully

  @unit
  Scenario: Suite target schema allows code agent type
    Given a suite target with type "code" and a referenceId
    Then the suite target schema validates successfully

  @unit
  Scenario: fieldMappings is optional for backwards compatibility
    Given a suite target with type "prompt" and a referenceId
    When no fieldMappings are provided
    Then the suite target schema validates successfully

  @unit
  Scenario: Simulation target schema accepts fieldMappings
    Given a simulation target with type "http" and a referenceId
    When fieldMappings maps "input" to source "scenario" path ["input"]
    Then the simulation target schema validates successfully

  # --- Pipeline Threading ---

  @unit
  Scenario: fieldMappings threads through scenario job schema
    Given a scenario job payload with fieldMappings
    When the job schema validates
    Then the fieldMappings are preserved in the parsed output

  @unit
  Scenario: fieldMappings threads through child process data schema
    Given child process data with fieldMappings
    When the data schema validates
    Then the fieldMappings are preserved in the parsed output

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
  Scenario: Prompt adapter uses conversation messages directly
    Given a prompt target
    When the adapter processes an agent input
    Then the prompt receives the conversation messages directly
    And fieldMappings are not used

  # --- Default Mappings ---

  @unit
  Scenario: Single-input agent generates default fieldMappings
    Given an agent with a single input "query"
    When computing default mappings
    Then "query" is mapped to source "scenario" path ["input"]

  @unit
  Scenario: Multi-input agent has no default fieldMappings
    Given an agent with inputs "query" and "context"
    When computing default mappings
    Then no default mappings are generated

  # --- UI ---

  @integration
  Scenario: Target picker shows mapping section for multi-input code agent
    Given a suite with a code agent target that has inputs "query" and "context"
    When the target picker renders
    Then a "Scenario Input Mapping" section appears for that target
    And each input field shows a mapping dropdown

  @integration
  Scenario: Mapping dropdown offers scenario sources
    Given the mapping UI is rendered for a code agent input
    When the user opens the mapping dropdown
    Then "input" is available as a source
    And "messages" is available as a source
    And "threadId" is available as a source

  @integration
  Scenario: User can set a static value mapping
    Given the mapping UI is rendered for a code agent input "context"
    When the user types "Use the knowledge base" as a static value
    Then the fieldMappings for "context" has type "value" with that text

  @integration
  Scenario: Static value mapping round-trips through save and reload
    Given a code agent with inputs "query" and "context"
    And a stored mapping for "context" with type "value" and text "Use the KB"
    When the agent editor opens the Scenario Mappings section
    Then the row for "context" displays the static text "Use the KB"
    And editing the row preserves the static value in the stored mappings

  @integration
  Scenario: HTTP agent editor renders Scenario Mappings section
    Given a new HTTP agent editor drawer is open
    When the editor renders
    Then a "Scenario Mappings" section appears below the body template
    And selecting a scenario source for an input updates the agent config's scenarioMappings on save

  @integration
  Scenario: Mapping changes update form state on suite target
    Given a suite with a code agent target
    When the user maps "query" to "input"
    Then the form state for that target's fieldMappings reflects the mapping

  # --- Ad-hoc Run Path ---

  @integration
  Scenario: Ad-hoc scenario run accepts fieldMappings
    Given a scenario with a code agent target
    When an ad-hoc run is triggered with fieldMappings
    Then the run is scheduled with the mappings on the job payload

  # --- Backwards Compatibility ---

  @unit
  Scenario: Existing suites without fieldMappings parse successfully
    Given a stored suite target JSON with type "prompt" and no fieldMappings
    When parsed by the suite target schema
    Then parsing succeeds with fieldMappings undefined

  @unit
  Scenario: Adapters use legacy behavior when fieldMappings is undefined
    Given an adapter receives undefined fieldMappings
    When processing an agent input
    Then the adapter uses its original hardcoded input logic
