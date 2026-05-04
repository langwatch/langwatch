Feature: Shorthand prompt tag syntax (server-side)
  As a developer using LangWatch prompts
  I want the API to parse shorthand syntax like "pizza-prompt:production" in the path
  So that SDKs can pass the string straight through without parsing it themselves

  # --- Shorthand Parsing (pure logic, no tag allowlist needed) ---

  @unit @unimplemented
  Scenario: Rejects zero as a tag name during creation
    Given the allowed tags are "production" and "staging"
    When a user tries to create a tag named "0"
    Then the creation is rejected with a validation error

  @unit @unimplemented
  Scenario: Accepts valid non-numeric tag during creation
    Given the allowed tags are "production" and "staging"
    When a user tries to create a tag named "production"
    Then the creation succeeds
