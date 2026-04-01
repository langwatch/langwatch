Feature: Python SDK custom label support
  As a Python SDK user
  I want to fetch prompts by label and manage label assignments
  So that I can pin my code to labeled versions and promote versions across environments

  Background:
    Given a LangWatch client initialized with a valid API key

  # --- Fetch by label ---

  @unit
  Scenario: fetches prompt by built-in label
    Given "pizza-prompt" has production=v3 and latest=v4
    When I call prompts.get("pizza-prompt", label="production")
    Then I receive version v3 config data

  @unit
  Scenario: fetches prompt by custom label
    Given "pizza-prompt" has custom label "canary" assigned to v2
    When I call prompts.get("pizza-prompt", label="canary")
    Then I receive version v2 config data

  @unit
  Scenario: returns latest when no label given
    Given "pizza-prompt" has latest=v4
    When I call prompts.get("pizza-prompt")
    Then I receive version v4 config data (unchanged behavior)

  @unit
  Scenario: fetches prompt by label using shorthand syntax
    Given "pizza-prompt" has production=v3
    When I call prompts.get("pizza-prompt:production")
    Then I receive version v3 config data

  @unit
  Scenario: rejects ambiguous shorthand with explicit label
    When I call prompts.get("pizza-prompt:production", label="staging")
    Then the SDK raises a ValueError before calling the API

  # --- Label + fetch policy interactions ---

  @unit
  Scenario: skips local files when label is provided with MATERIALIZED_FIRST
    Given "pizza-prompt" exists in materialized local files
    And the API has "pizza-prompt" with label "production" pointing to v3
    When I call prompts.get("pizza-prompt", label="production")
    Then the SDK fetches from the API, not from local files
    And I receive version v3 config data

  # --- Cache key isolation ---

  @unit
  Scenario: includes label in cache key
    Given "pizza-prompt" has production=v3
    When I call get("pizza-prompt", label="production", fetch_policy=CACHE_TTL)
    Then the cache key includes the label
    And it returns v3

  @unit
  Scenario: caches different labels independently
    Given "pizza-prompt" has production=v3 and staging=v4
    When I fetch with label "production" using CACHE_TTL
    And I fetch with label "staging" using CACHE_TTL
    Then both results are cached independently

  # --- Mutual exclusion ---

  @unit
  Scenario: rejects request with both version and label
    When I call prompts.get("pizza-prompt", version_number=3, label="production")
    Then the SDK raises a ValueError before calling the API

  # --- Error handling ---

  @unit
  Scenario: propagates error for unassigned label
    Given "pizza-prompt" has no version assigned to "canary"
    When I call get("pizza-prompt", label="canary")
    Then the API returns an error and the SDK propagates it

  # --- Label assignment (sub-resource) ---

  @unit
  Scenario: assigns label and returns confirmation
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.labels.assign("pizza-prompt", label="production", version_id=versionId)
    Then the API receives PUT /api/prompts/pizza-prompt/labels/production
    And the request body contains the versionId
    And I receive a response with config_id, version_id, label, and updated_at

  @unit
  Scenario: assigns custom label to existing version
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.labels.assign("pizza-prompt", label="canary", version_id=versionId)
    Then the API receives PUT /api/prompts/pizza-prompt/labels/canary
    And the request body contains the versionId

  # --- Labels on create/update ---

  @unit
  Scenario: includes labels in create request body
    When I call prompts.create with a labels list containing "production"
    Then the API request body includes the labels list

  @unit
  Scenario: includes labels in update request body
    When I call prompts.update with a labels list containing "staging"
    Then the API request body includes the labels list

  # --- API layer ---

  @unit
  Scenario: passes label as query parameter to the API
    When I call PromptApiService.get("pizza-prompt", label="production")
    Then the API request includes query parameter label="production"

  @unit
  Scenario: passes custom label string through to the API
    When I call PromptApiService.get("pizza-prompt", label="canary")
    Then the API request includes query parameter label="canary"

  # --- E2E (real API) ---

  @e2e
  Scenario: assigns label and fetches by label via real API
    Given I create a prompt with two versions via the SDK
    When I assign the "production" label to version 1
    And I fetch the prompt with label "production"
    Then I receive version 1 config data

  @e2e
  Scenario: reassigns label to newer version
    Given a prompt with "production" label assigned to version 1
    When I reassign "production" to version 2
    And I fetch the prompt with label "production"
    Then I receive version 2 config data
