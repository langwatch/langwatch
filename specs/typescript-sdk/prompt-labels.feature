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

  # --- Custom label fetch (transparent) ---

  @unit
  Scenario: Fetch prompt by custom label
    Given "pizza-prompt" has custom label "canary" assigned to v2
    When I call prompts.get("pizza-prompt", { label: "canary" })
    Then I receive version v2 config data

  @unit
  Scenario: Label type accepts any string
    When I call prompts.get("pizza-prompt", { label: "canary" })
    Then the TypeScript compiler accepts it without error
    And the API request includes query parameter label="canary"

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

  @unit
  Scenario: Custom labels produce distinct cache entries
    Given "pizza-prompt" has custom label "canary" assigned to v2 and production=v3
    When I fetch with label "canary" using CACHE_TTL
    And I fetch with label "production" using CACHE_TTL
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
  Scenario: Assign custom label to existing version
    Given "pizza-prompt" version v2 exists with a known versionId
    And a custom label "canary" exists in the org
    When I call prompts.labels.assign("pizza-prompt", { label: "canary", versionId })
    Then the API receives PUT /api/prompts/pizza-prompt/labels/canary
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

  # --- Org-level label CRUD via SDK ---

  @unit
  Scenario: List labels returns built-in and custom labels
    Given the org has custom labels "canary" and "ab-test"
    When I call prompts.labels.list()
    Then the response includes "latest", "production", "staging", "canary", "ab-test"
    And built-in labels have type "built-in"
    And custom labels have type "custom"

  @unit
  Scenario: List labels calls GET /api/orgs/:orgId/prompt-labels
    When I call prompts.labels.list()
    Then the SDK sends GET /api/orgs/:orgId/prompt-labels

  @unit
  Scenario: Create custom label via SDK
    When I call prompts.labels.create({ name: "canary" })
    Then the SDK sends POST /api/orgs/:orgId/prompt-labels with name "canary"
    And the response contains an id and name "canary"

  @unit
  Scenario: Delete custom label via SDK
    Given a custom label "canary" exists with a known labelId
    When I call prompts.labels.delete(labelId)
    Then the SDK sends DELETE /api/orgs/:orgId/prompt-labels/:labelId
    And the response status is 204

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

  @e2e
  Scenario: Create custom label, assign it, and fetch by it
    Given I create a custom label "canary" via the SDK
    And I create a prompt with two versions via the SDK
    When I assign the "canary" label to version 2
    And I fetch the prompt with label "canary"
    Then I receive version 2 config data

  @e2e
  Scenario: List labels includes a newly created custom label
    Given I create a custom label "canary" via the SDK
    When I list all labels via the SDK
    Then the response includes "canary" alongside the built-in labels

  @e2e
  Scenario: Delete custom label removes it from the list
    Given I create a custom label "canary" via the SDK
    When I delete the "canary" label via the SDK
    And I list all labels via the SDK
    Then the response does not include "canary"
