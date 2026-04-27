Feature: Workflow agent scenario interpolation and type coverage
  As a scenario author running a Studio workflow as a Workflow Agent
  I want prompt template variables interpolated correctly and every Studio-exposed field type to work
  So that multi-turn scenarios behave predictably and no user-selectable type crashes the NLP service

  Issue: langwatch/langwatch#3415

  Background:
    Given the NLP service is running and reachable
    And a project exists with a published workflow that has
      | node      | kind      |
      | entry     | entry     |
      | llm_call  | signature |
      | end       | end       |
    And the signature node prompt template references
      """
      question: {{question}}
      thread_id: {{thread_id}}
      messages: {{messages}}
      random_static_value: {{random_static_value}}
      """
    And the signature node has a static variable "random_static_value" set to "bob is your uncle"
    And the scenario mappings wire agent_input.question, agent_input.messages, agent_input.thread_id onto the workflow's entry fields

  # --- AC 1: Interpolation (parrot-back) ---

  @integration
  Scenario: All scenario-mapped and static variables interpolate into the LLM prompt
    Given the entry and signature node inputs are all typed "str"
    And the scenario supplies a 2-turn conversation history with thread id "thread-123"
    When the workflow agent is invoked inside a scenario run
    Then the LLM provider request payload contains the substituted value for question
    And the payload contains the substituted value for thread_id "thread-123"
    And the payload contains the substituted conversation turns
    And the payload contains the static value "bob is your uncle"
    And the payload contains no unresolved "{{" template markers

  # --- AC 2: chat_messages type no longer crashes ---

  @integration
  Scenario: chat_messages-typed signature input runs without HTTP 500
    Given the entry output "messages" is typed "chat_messages"
    And the signature input "messages" is typed "chat_messages"
    When the workflow agent is invoked inside a scenario run
    Then the run completes without raising an UndefinedError
    And the workflow code generation produces a signature whose "messages" field annotation is a DSPy history type
    And the LLM provider receives the conversation turns with preserved role/content

  # --- AC 3: No regression for existing string-typed workflows ---

  @integration
  Scenario: Pre-existing str-typed workflows still function
    Given a workflow whose entry and signature node inputs are all typed "str"
    And the signature node prompt template references "{{question}}" only
    When the workflow agent is invoked inside a scenario run
    Then the LLM provider request payload contains the substituted question
    And the generated workflow code and execution path match the pre-fix behavior for str inputs

  # --- AC 4: Multi-turn preserved as distinct chat turns ---

  @integration
  Scenario: A 2-turn scenario produces at least 2 distinct provider messages
    Given a scenario with a conversation history of 2 turns (user then assistant then user)
    And the workflow signature consumes the history via a chat_messages-typed input
    When the workflow agent is invoked inside the scenario run
    Then the captured LLM provider payload contains at least 2 structurally distinct messages
    And the role of each captured message matches the original scenario turn's role
    And the captured messages do not collapse the history into a single user message containing escaped JSON

  # --- AC 5: Unmapped field types fail with a clear, structured error ---

  @unit
  Scenario: A field type not present in FIELD_TYPE_TO_DSPY_TYPE produces a structured error
    Given a signature node whose input "foo" has a type not present in FIELD_TYPE_TO_DSPY_TYPE
    When the workflow is parsed for execution
    Then an error is raised identifying the node id, field identifier, and unmapped type
    And the error is not the bare Jinja "'dict object' has no attribute" message

  # --- AC 6: Type-agnostic interpolation ---

  @integration
  Scenario Outline: Same template interpolates cleanly across Studio-exposed field types
    Given a signature input "foo" typed "<field_type>"
    And the prompt template references "{{foo}}"
    When the workflow agent is invoked with an appropriately-typed value for foo
    Then the rendered prompt contains a human-readable representation of the value
    And no unresolved "{{" markers remain
    And the run completes without HTTP 500

    Examples:
      | field_type     |
      | str            |
      | int            |
      | float          |
      | bool           |
      | list           |
      | list_str       |
      | dict           |
      | chat_messages  |
