Feature: Python SDK custom tag support
  As a Python SDK user
  I want to fetch prompts by tag and manage tag assignments
  So that I can pin my code to tagged versions and promote versions across environments

  Background:
    Given a LangWatch client initialized with a valid API key

  # --- Fetch by tag ---

  @unit
  Scenario: fetches prompt by built-in tag
    Given "pizza-prompt" has production=v3 and latest=v4
    When I call prompts.get("pizza-prompt", tag="production")
    Then I receive version v3 config data

  @unit
  Scenario: fetches prompt by custom tag
    Given "pizza-prompt" has custom tag "canary" assigned to v2
    When I call prompts.get("pizza-prompt", tag="canary")
    Then I receive version v2 config data

  @unit
  Scenario: returns latest when no tag given
    Given "pizza-prompt" has latest=v4
    When I call prompts.get("pizza-prompt")
    Then I receive version v4 config data (unchanged behavior)

  @unit
  Scenario: shorthand syntax passes through to API
    When I call prompts.get("pizza-prompt:production")
    Then the SDK passes "pizza-prompt:production" as the ID to the API
    And the API resolves it server-side

  # --- Tag + fetch policy interactions ---

  @unit
  Scenario: skips local files when tag is provided with MATERIALIZED_FIRST
    Given "pizza-prompt" exists in materialized local files
    And the API has "pizza-prompt" with tag "production" pointing to v3
    When I call prompts.get("pizza-prompt", tag="production")
    Then the SDK fetches from the API, not from local files
    And I receive version v3 config data

  # --- Cache key isolation ---

  @unit
  Scenario: includes tag in cache key
    Given "pizza-prompt" has production=v3
    When I call get("pizza-prompt", tag="production", fetch_policy=CACHE_TTL)
    Then the cache key includes the tag
    And it returns v3

  @unit
  Scenario: caches different tags independently
    Given "pizza-prompt" has production=v3 and staging=v4
    When I fetch with tag "production" using CACHE_TTL
    And I fetch with tag "staging" using CACHE_TTL
    Then both results are cached independently

  # --- Error handling ---

  @unit
  Scenario: propagates API error for unassigned tag
    Given "pizza-prompt" has no version assigned to "canary"
    When I call get("pizza-prompt", tag="canary")
    Then the API returns an error and the SDK propagates it

  # --- Tag assignment (sub-resource) ---

  @unit
  Scenario: assigns tag and returns confirmation
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.tags.assign("pizza-prompt", tag="production", version_id=versionId)
    Then the API receives PUT /api/prompts/pizza-prompt/tags/production
    And the request body contains the versionId
    And I receive a response with config_id, version_id, tag, and updated_at

  @unit
  Scenario: assigns custom tag to existing version
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.tags.assign("pizza-prompt", tag="canary", version_id=versionId)
    Then the API receives PUT /api/prompts/pizza-prompt/tags/canary
    And the request body contains the versionId

  # --- Tags on create/update ---

  @unit
  Scenario: includes tags in create request body
    When I call prompts.create with a tags list containing "production"
    Then the API request body includes the tags list

  @unit
  Scenario: includes tags in update request body
    When I call prompts.update with a tags list containing "staging"
    Then the API request body includes the tags list

  # --- API layer ---

  @unit
  Scenario: passes tag as query parameter to the API
    When I call PromptApiService.get("pizza-prompt", tag="production")
    Then the API request includes query parameter tag="production"

  @unit
  Scenario: passes custom tag string through to the API
    When I call PromptApiService.get("pizza-prompt", tag="canary")
    Then the API request includes query parameter tag="canary"

  # --- E2E (real API) ---

  @e2e
  Scenario: assigns tag and fetches by tag via real API
    Given I create a prompt with two versions via the SDK
    When I assign the "production" tag to version 1
    And I fetch the prompt with tag "production"
    Then I receive version 1 config data

  @e2e
  Scenario: reassigns tag to newer version
    Given a prompt with "production" tag assigned to version 1
    When I reassign "production" to version 2
    And I fetch the prompt with tag "production"
    Then I receive version 2 config data
