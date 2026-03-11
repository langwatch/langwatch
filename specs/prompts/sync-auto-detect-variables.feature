Feature: Auto-detect prompt variables during sync
  As a developer using `langwatch prompt sync`
  I want template variables in my prompt text to be automatically detected and created as inputs
  So that the platform shows them correctly without "Undefined variables" warnings

  Background:
    Given a project with the Prompts CLI configured
    And the server uses Liquid-aware variable extraction (shared with frontend)

  # --- Variable extraction (pure logic) ---

  @unit
  Scenario: Extracts simple mustache variables from prompt text
    Given a prompt with text "hello {{name}}, how is your {{pet_name}} today?"
    When the server extracts variables from the prompt
    Then it detects variables "name" and "pet_name"

  @unit
  Scenario: Extracts variables from all messages (system + user)
    Given a prompt with system message "You are a {{role}} assistant"
    And a user message "Help me with {{task}}"
    When the server extracts variables from all messages
    Then it detects variables "role" and "task"

  @unit
  Scenario: Ignores loop iterator variables
    Given a prompt with text "{% for col in column_headers %}{{ col.column_name }}{% endfor %}"
    When the server extracts variables from the prompt
    Then it detects variable "column_headers"
    And it does not detect "col" as a variable

  @unit
  Scenario: Ignores assigned variables
    Given a prompt with text "{% assign greeting = 'Hello' %}{{ greeting }} {{ name }}"
    When the server extracts variables from the prompt
    Then it detects variable "name"
    And it does not detect "greeting" as a variable

  @unit
  Scenario: Handles dot notation by extracting root variable
    Given a prompt with text "{{ user.name }} lives in {{ user.city }}"
    When the server extracts variables from the prompt
    Then it detects variable "user"
    And it does not detect "user.name" or "user.city" as separate variables

  # --- Merge logic ---

  @unit
  Scenario: Merges detected variables with explicitly provided inputs
    Given a prompt with text "hello {{name}}, your pet {{pet_name}} says hi"
    And the sync payload has inputs [{ identifier: "name", type: "str" }]
    When syncPrompt processes the request
    Then the resulting inputs contain "name" with type "str" (from explicit input)
    And the resulting inputs contain "pet_name" with type "str" (auto-detected)

  @unit
  Scenario: Preserves existing input types when merging
    Given a prompt with text "data: {{config}}"
    And the sync payload has inputs [{ identifier: "config", type: "dict" }]
    When syncPrompt processes the request
    Then the resulting inputs contain "config" with type "dict" (preserved, not overwritten)

  @unit
  Scenario: Inputs are sorted alphabetically by identifier for deterministic ordering
    Given a prompt with text "{{zebra}} {{alpha}} {{middle}}"
    When the server merges auto-detected variables
    Then the resulting inputs are ordered: "alpha", "middle", "zebra"

  @unit
  Scenario: CLI hardcoded "input" default is kept only when it appears in the template
    Given a prompt with text "hello {{name}}"
    And the sync payload has inputs [{ identifier: "input", type: "str" }] (CLI default)
    When syncPrompt processes the request
    Then the resulting inputs contain "input" and "name"
    # The server cannot distinguish CLI defaults from intentional inputs

  # --- Diff stability ---

  @unit
  Scenario: Repeated sync with same variables does not create a new version
    Given a prompt already synced with text "hello {{name}}"
    And the stored inputs are [{ identifier: "name", type: "str" }]
    When the same prompt is synced again with the same text
    Then the sync returns "up_to_date" (no new version created)

  @unit
  Scenario: Reordering variables in template text does not create a new version
    Given a prompt already synced with inputs ["alpha", "zebra"] (sorted)
    When the prompt text changes variable order but not the variable set
    Then the sync returns "up_to_date" (inputs sorted identically)

  # --- Real-world scenario ---

  @unit
  Scenario: Auto-detected variables from a complex real-world prompt
    Given a prompt with system message containing:
      """
      # dto_schema:
      {{ dto_schema }}

      # Example candidates:
      {{ example_candidates }}

      {% for col in column_headers %}- {{ col.column_name }} (ID: {{ col.column_id }})
      {% endfor %}
      """
    And a user message "{{ input }}"
    When the server extracts and merges variables
    Then the resulting inputs contain "column_headers", "dto_schema", "example_candidates", and "input"
    And the resulting inputs do not contain "col"
    And all auto-detected inputs default to type "str"

  # --- Architecture notes (not scenarios) ---
  # - extractLiquidVariables lives in a shared location importable by both server and frontend
  # - The extraction runs in syncPrompt BEFORE comparison, so both local and remote see merged inputs
  # - Inputs array is always sorted by identifier for deterministic comparison
