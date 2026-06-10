Feature: Shorthand prompt tag syntax (server-side)
  As a developer using LangWatch prompts
  I want the API to parse shorthand syntax like "pizza-prompt:production" in the path
  So that SDKs can pass the string straight through without parsing it themselves

  # Both scenarios bound to prompt-tag.service.unit.test.ts validateTagName.
  # Manifest's stale Given clause ("allowed tags are production and staging") is
  # outdated — only "latest" is in PROTECTED_TAGS now; any lowercase non-numeric
  # slug is allowed. Behavior asserted via validateTagName unit tests.

  # --- Shorthand Parsing (pure logic, no tag allowlist needed) ---

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
