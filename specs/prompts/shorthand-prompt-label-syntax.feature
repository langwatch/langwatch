Feature: Shorthand prompt tag syntax (server-side)
  As a developer using LangWatch prompts
  I want the API to parse shorthand syntax like "pizza-prompt:production" in the path
  So that SDKs can pass the string straight through without parsing it themselves

  # --- Shorthand Parsing (pure logic, no tag allowlist needed) ---

  @unit
  Scenario: Parses tag shorthand from slug:tag format
    When parsePromptShorthand receives "pizza-prompt:production"
    Then it returns slug "pizza-prompt" with tag "production"

  @unit
  Scenario: Parses version shorthand from slug:number format
    When parsePromptShorthand receives "pizza-prompt:2"
    Then it returns slug "pizza-prompt" with version 2

  @unit
  Scenario: Parses bare slug without suffix
    When parsePromptShorthand receives "pizza-prompt"
    Then it returns slug "pizza-prompt" with no tag or version

  @unit
  Scenario: Treats "latest" as no tag
    When parsePromptShorthand receives "pizza-prompt:latest"
    Then it returns slug "pizza-prompt" with no tag or version

  @unit
  Scenario: Preserves slugs containing a single slash
    When parsePromptShorthand receives "my-org/prompt:staging"
    Then it returns slug "my-org/prompt" with tag "staging"

  @unit
  Scenario: Rejects empty slug before colon
    When parsePromptShorthand receives ":production"
    Then it returns an error indicating invalid format

  @unit
  Scenario: Rejects empty suffix after colon
    When parsePromptShorthand receives "pizza-prompt:"
    Then it returns an error indicating invalid format

  # --- Span attribute parsing (tag extension) ---

  @unit
  Scenario: Span attribute containing slug:tag shorthand resolves to handle and tag
    Given span attribute "langwatch.prompt.id" is "pizza-prompt:production"
    When parsePromptReference parses the attributes
    Then it returns handle "pizza-prompt" with label "production"

  @unit
  Scenario: Span attribute containing slug:number shorthand resolves to handle and version
    Given span attribute "langwatch.prompt.id" is "pizza-prompt:3"
    When parsePromptReference parses the attributes
    Then it returns handle "pizza-prompt" with version 3

  # --- Non-numeric tag enforcement (requires tag allowlist context) ---

  @unit
  Scenario: Rejects purely numeric tag name during creation
    Given the allowed tags are "production" and "staging"
    When a user tries to create a tag named "42"
    Then the creation is rejected with a validation error
    And the error explains that tag names must not be purely numeric

  @unit
  Scenario: Rejects zero as a tag name during creation
    Given the allowed tags are "production" and "staging"
    When a user tries to create a tag named "0"
    Then the creation is rejected with a validation error

  @unit
  Scenario: Accepts valid non-numeric tag during creation
    Given the allowed tags are "production" and "staging"
    When a user tries to create a tag named "production"
    Then the creation succeeds

  @unit
  Scenario: Rejects "latest" as a tag name during creation
    Given "latest" is a reserved keyword in shorthand syntax
    When a user tries to create a tag named "latest"
    Then the creation is rejected with a validation error

  # --- REST API shorthand integration ---

  @integration
  Scenario: REST API resolves shorthand in the path
    Given "pizza-prompt" has production=v3
    When I call GET /api/prompts/pizza-prompt:production
    Then I receive version v3

  @integration
  Scenario: REST API rejects shorthand path combined with tag query param
    Given "pizza-prompt" has production=v3 and staging=v2
    When I call GET /api/prompts/pizza-prompt:production?tag=staging
    Then the request fails with a 422 error explaining the conflict

  @integration
  Scenario: Malformed shorthand returns 422 not 500
    When I call GET /api/prompts/:production
    Then the request fails with a 422 error about invalid format

  @integration
  Scenario: Empty suffix shorthand returns 422 not 500
    When I call GET /api/prompts/pizza-prompt:
    Then the request fails with a 422 error about invalid format

  @integration
  Scenario: Shorthand is not parsed in the tag-assignment route
    Given "pizza-prompt" exists
    When I call PUT /api/prompts/pizza-prompt/tags/production with a versionId
    Then the tag is assigned to that version
    And the route does not attempt to parse "pizza-prompt" as shorthand
