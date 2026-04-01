Feature: Python SDK Prompt Label Support
  As a Python developer using the LangWatch SDK
  I want to fetch prompts by label and manage label assignments
  So that I can control which prompt version is used per environment

  Background:
    Given the LangWatch Python SDK is configured with a valid API key

  # --- Fetch by Label ---

  @integration
  Scenario: Fetch prompt by label
    Given the API returns version v3 for "pizza-prompt" with label "production"
    When I call langwatch.prompts.get("pizza-prompt:production")
    Then the SDK sends GET /api/prompts/pizza-prompt?label=production
    And I receive version v3 config data

  @integration
  Scenario: Fetch without label returns latest
    Given the API returns the latest version v4 for "pizza-prompt"
    When I call langwatch.prompts.get("pizza-prompt")
    Then the SDK sends GET /api/prompts/pizza-prompt without a label query parameter
    And I receive version v4 config data

  # --- Mutual Exclusion ---

  @unit
  Scenario: Providing both version and label raises an error
    When I call langwatch.prompts.get("pizza-prompt", version_number=3, label="production")
    Then the SDK raises a ValueError before making any API call

  # --- Cache Isolation ---

  @integration
  Scenario: Labeled and unlabeled fetches return independent results
    Given the API returns v3 for label "production" and v4 for no label
    When I call get("pizza-prompt:production") with CACHE_TTL policy
    And I call get("pizza-prompt") with CACHE_TTL policy
    Then the API is called twice (no cache collision)
    And the first call returns v3
    And the second call returns v4

  @integration
  Scenario: Fetches with different labels return independent results
    Given the API returns v3 for label "production" and v2 for label "staging"
    When I call get("pizza-prompt:production") with CACHE_TTL policy
    And I call get("pizza-prompt:staging") with CACHE_TTL policy
    Then the API is called twice
    And the results are v3 and v2 respectively

  # --- Fetch Policy + Label Interaction ---

  @unit
  Scenario: Label with MATERIALIZED_ONLY raises an error
    When I call get("pizza-prompt:production", fetch_policy=MATERIALIZED_ONLY)
    Then the SDK raises a ValueError indicating labels require API access

  @integration
  Scenario: Label with MATERIALIZED_FIRST skips local and fetches from API
    Given a local prompt file exists for "pizza-prompt"
    And the API returns v3 for label "production"
    When I call get("pizza-prompt:production", fetch_policy=MATERIALIZED_FIRST)
    Then the SDK fetches from the API (not local files)
    And I receive version v3

  # --- Error Propagation ---

  @integration
  Scenario: Unassigned label propagates API error
    Given the API returns a not-found error for label "production" on "pizza-prompt"
    When I call langwatch.prompts.get("pizza-prompt:production")
    Then the SDK raises an error with the API error message

  # --- Label Assignment ---

  @integration
  Scenario: Assign label to existing version
    Given a valid prompt "pizza-prompt" with version_id "prompt_version_abc123"
    When I call langwatch.prompts.labels.assign("pizza-prompt", label="production", version_id="prompt_version_abc123")
    Then the SDK sends PUT /api/prompts/pizza-prompt/labels/production with body {"versionId": "prompt_version_abc123"}
    And the response confirms the assignment

  # --- Labels on Create/Update ---

  @integration
  Scenario: Create prompt with labels
    When I call langwatch.prompts.create with labels=["production"]
    Then the SDK sends POST /api/prompts with labels ["production"] in the request body

  @integration
  Scenario: Update prompt with labels
    When I call langwatch.prompts.update with labels=["staging"]
    Then the SDK sends PUT /api/prompts/{id} with labels ["staging"] in the request body
