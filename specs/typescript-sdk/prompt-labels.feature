Feature: SDK Prompt Label Support
  As an SDK consumer
  I want to fetch prompts by label (e.g., "production", "staging")
  So that I can pin my code to a labeled version without hardcoding version numbers

  Background:
    Given a LangWatch client initialized with a valid API key

  # --- Fetch by label ---

  @unit
  Scenario: Fetch prompt by label
    Given "pizza-prompt" has production=v3 and latest=v4
    When I call prompts.get("pizza-prompt", { label: "production" })
    Then I receive version v3 config data

  @unit
  Scenario: Fetch without label returns latest
    Given "pizza-prompt" has latest=v4
    When I call prompts.get("pizza-prompt")
    Then I receive version v4 config data (unchanged behavior)

  # --- Cache key isolation ---

  @unit
  Scenario: Label is included in cache key
    Given "pizza-prompt" has production=v3
    When I call get("pizza-prompt", { label: "production", fetchPolicy: "CACHE_TTL" })
    Then the cache key includes the label
    And it returns v3

  @unit
  Scenario: Different labels produce different cache entries
    Given "pizza-prompt" has production=v3 and staging=v4
    When I fetch with label "production" using CACHE_TTL
    And I fetch with label "staging" using CACHE_TTL
    Then both results are cached independently

  # --- Error handling ---

  @unit
  Scenario: Invalid label returns clear error
    Given "pizza-prompt" has no label "canary"
    When I call get("pizza-prompt", { label: "canary" })
    Then I receive a clear error indicating the label does not exist

  # --- API layer ---

  @unit
  Scenario: Label is passed as query parameter to the API
    When I call PromptsApiService.get("pizza-prompt", { label: "production" })
    Then the API request includes query parameter label="production"

  @unit
  Scenario: Label and version are mutually exclusive in API call
    When I call PromptsApiService.get("pizza-prompt", { label: "production", version: "3" })
    Then both label and version are sent to the API (server validates mutual exclusion)
