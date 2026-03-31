Feature: Shorthand prompt label syntax
  As a developer using LangWatch prompts
  I want to reference labeled prompts with shorthand syntax like "pizza-prompt:production"
  So that I can specify environment labels inline without verbose config objects

  # --- Shorthand Parsing (pure logic, no label allowlist needed) ---

  @unit
  Scenario: Parses label shorthand from slug:label format
    When parsePromptShorthand receives "pizza-prompt:production"
    Then it returns slug "pizza-prompt" with label "production"

  @unit
  Scenario: Parses version shorthand from slug:number format
    When parsePromptShorthand receives "pizza-prompt:2"
    Then it returns slug "pizza-prompt" with version 2

  @unit
  Scenario: Parses bare slug without suffix
    When parsePromptShorthand receives "pizza-prompt"
    Then it returns slug "pizza-prompt" with no label or version

  @unit
  Scenario: Treats "latest" as no label
    When parsePromptShorthand receives "pizza-prompt:latest"
    Then it returns slug "pizza-prompt" with no label or version

  @unit
  Scenario: Preserves slugs containing a single slash
    When parsePromptShorthand receives "my-org/prompt:staging"
    Then it returns slug "my-org/prompt" with label "staging"

  @unit
  Scenario: Rejects empty slug before colon
    When parsePromptShorthand receives ":production"
    Then it returns an error indicating invalid format

  # --- Span attribute parsing (label extension) ---

  @unit
  Scenario: Span attribute containing slug:label shorthand resolves to handle and label
    Given span attribute "langwatch.prompt.id" is "pizza-prompt:production"
    When parsePromptReference parses the attributes
    Then it returns handle "pizza-prompt" with label "production"

  @unit
  Scenario: Span attribute containing slug:number shorthand resolves to handle and version
    Given span attribute "langwatch.prompt.id" is "pizza-prompt:3"
    When parsePromptReference parses the attributes
    Then it returns handle "pizza-prompt" with version 3

  # --- Non-numeric label enforcement (requires label allowlist context) ---

  @unit
  Scenario: Rejects purely numeric label name during creation
    Given the allowed labels are "production" and "staging"
    When a user tries to create a label named "42"
    Then the creation is rejected with a validation error
    And the error explains that label names must not be purely numeric

  @unit
  Scenario: Rejects zero as a label name during creation
    Given the allowed labels are "production" and "staging"
    When a user tries to create a label named "0"
    Then the creation is rejected with a validation error

  @unit
  Scenario: Accepts valid non-numeric label during creation
    Given the allowed labels are "production" and "staging"
    When a user tries to create a label named "production"
    Then the creation succeeds

  @unit
  Scenario: Rejects "latest" as a label name during creation
    Given "latest" is a reserved keyword in shorthand syntax
    When a user tries to create a label named "latest"
    Then the creation is rejected with a validation error

  # --- SDK resolution (TypeScript) ---

  @integration
  Scenario: TS SDK resolves label shorthand to the labeled version
    Given "pizza-prompt" has production=v3 and latest=v4
    When the TS SDK resolves "pizza-prompt:production"
    Then it returns v3

  @integration
  Scenario: TS SDK resolves version shorthand to the numbered version
    Given "pizza-prompt" has versions v1 through v4
    When the TS SDK resolves "pizza-prompt:2"
    Then it returns v2

  @integration
  Scenario: TS SDK resolves bare slug to the latest version
    Given "pizza-prompt" has latest=v4
    When the TS SDK resolves "pizza-prompt"
    Then it returns v4

  @integration
  Scenario: TS SDK accepts explicit label option alongside slug
    Given "pizza-prompt" has staging=v2
    When the TS SDK resolves "pizza-prompt" with option label "staging"
    Then it returns v2

  # --- SDK resolution (Python) ---

  @integration
  Scenario: Python SDK resolves label shorthand to the labeled version
    Given "pizza-prompt" has production=v3 and latest=v4
    When the Python SDK resolves "pizza-prompt:production"
    Then it returns v3

  @integration
  Scenario: Python SDK resolves version shorthand to the numbered version
    Given "pizza-prompt" has versions v1 through v4
    When the Python SDK resolves "pizza-prompt:2"
    Then it returns v2

  @integration
  Scenario: Python SDK resolves bare slug to the latest version
    Given "pizza-prompt" has latest=v4
    When the Python SDK resolves "pizza-prompt"
    Then it returns v4

  @integration
  Scenario: Python SDK accepts explicit label parameter
    Given "pizza-prompt" has staging=v2
    When the Python SDK resolves "pizza-prompt" with label "staging"
    Then it returns v2

  # --- REST API shorthand integration ---

  @integration
  Scenario: REST API resolves shorthand in the path
    Given "pizza-prompt" has production=v3
    When I call GET /api/prompts/pizza-prompt:production
    Then I receive version v3

  @integration
  Scenario: REST API rejects shorthand path combined with label query param
    Given "pizza-prompt" has production=v3 and staging=v2
    When I call GET /api/prompts/pizza-prompt:production?label=staging
    Then the request fails with a 422 error explaining the conflict

  @integration
  Scenario: Shorthand is not parsed in the label-assignment route
    Given "pizza-prompt" exists
    When I call PUT /api/prompts/pizza-prompt/labels/production with a versionId
    Then the label is assigned to that version
    And the route does not attempt to parse "pizza-prompt" as shorthand
