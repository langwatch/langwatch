Feature: SDK Prompt Label Support
  As an SDK consumer
  I want to fetch prompts by label and manage label assignments
  So that I can pin my code to labeled versions and promote versions across environments

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
  Scenario: Unassigned label returns error
    Given "pizza-prompt" has no version assigned to "production"
    When I call get("pizza-prompt", { label: "production" })
    Then the API returns an error and the SDK propagates it

  # --- Label assignment (sub-resource) ---

  @unit
  Scenario: Assign label to existing version
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.labels.assign("pizza-prompt", { label: "production", versionId })
    Then the API receives PUT /api/prompts/pizza-prompt/labels/production
    And the request body contains the versionId

  @unit
  Scenario: Assign label returns confirmation
    When I call prompts.labels.assign("pizza-prompt", { label: "staging", versionId })
    Then I receive a response with configId, versionId, label, and updatedAt

  # --- Labels on create/update ---

  @unit
  Scenario: Create prompt with labels on initial version
    When I call prompts.create with a labels array containing "production"
    Then the API request body includes the labels array

  @unit
  Scenario: Update prompt with labels on new version
    When I call prompts.update with a labels array containing "staging"
    Then the API request body includes the labels array

  # --- API layer ---

  @unit
  Scenario: Label is passed as query parameter to the API
    When I call PromptsApiService.get("pizza-prompt", { label: "production" })
    Then the API request includes query parameter label="production"

  # --- E2E (real API) ---

  @e2e
  Scenario: Assign label and fetch by label via real API
    Given I create a prompt with two versions via the SDK
    When I assign the "production" label to version 1
    And I fetch the prompt with label "production"
    Then I receive version 1 config data

  @e2e
  Scenario: Reassign label to newer version
    Given a prompt with "production" label assigned to version 1
    When I reassign "production" to version 2
    And I fetch the prompt with label "production"
    Then I receive version 2 config data

  @e2e
  Scenario: Fetch without label returns latest version
    Given a prompt with "production" label assigned to version 1 and latest is version 2
    When I fetch the prompt without a label
    Then I receive version 2 config data

  @e2e
  Scenario: Fetch with unassigned label returns error
    Given a prompt with no labels assigned
    When I fetch the prompt with label "production"
    Then I receive an error
