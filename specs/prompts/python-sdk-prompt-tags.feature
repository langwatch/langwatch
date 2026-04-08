Feature: Python SDK Prompt Tag Support
  As a Python developer using the LangWatch SDK
  I want to fetch prompts by tag and manage tag assignments
  So that I can control which prompt version is used per environment

  Background:
    Given the LangWatch Python SDK is configured with a valid API key

  # --- Fetch by Tag ---

  @integration
  Scenario: Fetch prompt by tag
    Given the API returns version v3 for "pizza-prompt" with tag "production"
    When I call langwatch.prompts.get("pizza-prompt", tag="production")
    Then the SDK sends GET /api/prompts/pizza-prompt?tag=production
    And I receive version v3 config data

  @integration
  Scenario: Fetch without tag returns latest
    Given the API returns the latest version v4 for "pizza-prompt"
    When I call langwatch.prompts.get("pizza-prompt")
    Then the SDK sends GET /api/prompts/pizza-prompt without a tag query parameter
    And I receive version v4 config data

  # --- Shorthand Syntax ---

  @integration
  Scenario: Shorthand syntax passes through to API
    When I call langwatch.prompts.get("pizza-prompt:production")
    Then the SDK passes "pizza-prompt:production" as the ID to the generated client
    And the API resolves it server-side

  # --- Cache Isolation ---

  @integration
  Scenario: Tagged and untagged fetches return independent results
    Given the API returns v3 for tag "production" and v4 for no tag
    When I call get("pizza-prompt", tag="production") with CACHE_TTL policy
    And I call get("pizza-prompt") with CACHE_TTL policy
    Then the API is called twice (no cache collision)
    And the first call returns v3
    And the second call returns v4

  @integration
  Scenario: Fetches with different tags return independent results
    Given the API returns v3 for tag "production" and v2 for tag "staging"
    When I call get("pizza-prompt", tag="production") with CACHE_TTL policy
    And I call get("pizza-prompt", tag="staging") with CACHE_TTL policy
    Then the API is called twice
    And the results are v3 and v2 respectively

  # --- Fetch Policy + Tag Interaction ---

  @integration
  Scenario: Tag with MATERIALIZED_FIRST skips local and fetches from API
    Given a local prompt file exists for "pizza-prompt"
    And the API returns v3 for tag "production"
    When I call get("pizza-prompt", tag="production", fetch_policy=MATERIALIZED_FIRST)
    Then the SDK fetches from the API (not local files)
    And I receive version v3

  # --- Error Propagation ---

  @integration
  Scenario: Unassigned tag propagates API error
    Given the API returns a not-found error for tag "production" on "pizza-prompt"
    When I call langwatch.prompts.get("pizza-prompt", tag="production")
    Then the SDK raises an error with the API error message

  # --- Tag Assignment ---

  @integration
  Scenario: Assign tag to existing version
    Given a valid prompt "pizza-prompt" with version_id "prompt_version_abc123"
    When I call langwatch.prompts.tags.assign("pizza-prompt", tag="production", version_id="prompt_version_abc123")
    Then the SDK sends PUT /api/prompts/pizza-prompt/tags/production with body {"versionId": "prompt_version_abc123"}
    And the response confirms the assignment

  # --- Tags on Create/Update ---

  @integration
  Scenario: Create prompt with tags
    When I call langwatch.prompts.create with tags=["production"]
    Then the SDK sends POST /api/prompts with tags ["production"] in the request body

  @integration
  Scenario: Update prompt with tags
    When I call langwatch.prompts.update with tags=["staging"]
    Then the SDK sends PUT /api/prompts/{id} with tags ["staging"] in the request body
