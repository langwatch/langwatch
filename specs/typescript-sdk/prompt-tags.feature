Feature: SDK Prompt Tag Support
  As an SDK consumer
  I want to fetch prompts by tag and manage tag assignments
  So that I can pin my code to tagged versions and promote versions across environments

  Background:
    Given a LangWatch client initialized with a valid API key

  # --- Fetch by tag ---

  @unit
  Scenario: Fetch prompt by tag via options
    Given "pizza-prompt" has production=v3 and latest=v4
    When I call prompts.get("pizza-prompt", { tag: "production" })
    Then I receive version v3 config data

  @unit
  Scenario: Shorthand syntax passes through to API without client-side parsing
    When I call prompts.get("pizza-prompt:production")
    Then the SDK passes "pizza-prompt:production" as the ID to the API
    And the API resolves it server-side

  @unit
  Scenario: Fetch without tag returns latest
    Given "pizza-prompt" has latest=v4
    When I call prompts.get("pizza-prompt")
    Then I receive version v4 config data (unchanged behavior)

  # --- Custom tag fetch (transparent) ---
  # Note: fetch-by-custom-tag exercises the same SDK code path as built-in tags.
  # Type widening (tag: string instead of "production"|"staging") is verified at
  # compile time via pnpm typecheck — no separate runtime scenario needed.

  # --- Cache key isolation ---

  @unit
  Scenario: Tag is included in cache key
    Given "pizza-prompt" has production=v3
    When I call get("pizza-prompt", { tag: "production", fetchPolicy: "CACHE_TTL" })
    Then the cache key includes the tag
    And it returns v3

  @unit
  Scenario: Different tags produce different cache entries
    Given "pizza-prompt" has production=v3 and staging=v4
    When I fetch with tag "production" using CACHE_TTL
    And I fetch with tag "staging" using CACHE_TTL
    Then both results are cached independently

  # Note: custom tags reuse the same cache key logic as built-in tags
  # (any string in the tag segment). No separate scenario needed.

  # --- Error handling ---

  @unit
  Scenario: Unassigned tag returns error
    Given "pizza-prompt" has no version assigned to "production"
    When I call get("pizza-prompt", { tag: "production" })
    Then the API returns an error and the SDK surfaces it cleanly

  # --- Tag assignment (sub-resource) ---

  @unit
  Scenario: Assign tag to existing version
    Given "pizza-prompt" version v3 exists with a known versionId
    When I call prompts.tags.assign("pizza-prompt", { tag: "production", versionId })
    Then the API receives PUT /api/prompts/pizza-prompt/tags/production
    And the request body contains the versionId

  # Note: assign with custom tag uses same code path as built-in tags —
  # no separate unit scenario needed. Covered by E2E lifecycle test.

  @unit
  Scenario: Assign tag returns confirmation
    When I call prompts.tags.assign("pizza-prompt", { tag: "staging", versionId })
    Then I receive a response with configId, versionId, tag, and updatedAt

  # --- Tags on create/update ---

  @unit
  Scenario: Create prompt with tags on initial version
    When I call prompts.create with a tags array containing "production"
    Then the API request body includes the tags array

  @unit
  Scenario: Update prompt with tags on new version
    When I call prompts.update with a tags array containing "staging"
    Then the API request body includes the tags array

  # --- API layer ---
  # Note: "Tag is passed as query parameter" already covered in prompts-api.service.test.ts

  # --- Org-level tag CRUD via SDK ---

  @unit
  Scenario: List tags returns built-in and custom tags
    Given the org has custom tags "canary" and "ab-test"
    When I call prompts.tags.list()
    Then the response includes "latest", "production", "staging", "canary", "ab-test"
    And built-in tags have type "built-in"
    And custom tags have type "custom"

  @unit
  Scenario: List tags calls GET /api/prompts/tags
    When I call prompts.tags.list()
    Then the SDK sends GET /api/prompts/tags

  @unit
  Scenario: Create custom tag via SDK
    When I call prompts.tags.create({ name: "canary" })
    Then the SDK sends POST /api/prompts/tags with name "canary"
    And the response contains an id and name "canary"

  @unit
  Scenario: Delete custom tag via SDK
    Given a custom tag "canary" exists with a known tagId
    When I call prompts.tags.delete(tagId)
    Then the SDK sends DELETE /api/prompts/tags/:tagId
    And the response status is 204

  # --- E2E (real API) ---

  @e2e
  Scenario: Fetch tagged version via explicit tag option
    Given I create a prompt with two versions via the SDK
    And the "production" tag is assigned to version 1
    When I fetch the prompt using get(handle, { tag: "production" })
    Then I receive version 1 config data

  @e2e
  Scenario: Fetch tagged version via shorthand syntax
    Given I create a prompt with two versions via the SDK
    And the "production" tag is assigned to version 1
    When I fetch the prompt using get("handle:production")
    Then I receive version 1 config data

  @e2e
  Scenario: Fetch specific version via explicit version option
    Given I create a prompt with two versions via the SDK
    When I fetch the prompt using get(handle, { version: "1" })
    Then I receive version 1 config data

  @e2e
  Scenario: Fetch specific version via shorthand syntax
    Given I create a prompt with two versions via the SDK
    When I fetch the prompt using get("handle:1")
    Then I receive version 1 config data

  @e2e
  Scenario: Fetch without tag returns latest version
    Given a prompt with "production" tag assigned to version 1 and latest is version 2
    When I fetch the prompt without a tag or version
    Then I receive version 2 config data

  @e2e
  Scenario: Fetch with unassigned tag returns error via shorthand
    Given a prompt with no tags assigned
    When I fetch the prompt using get("handle:production")
    Then I receive an error

  @e2e
  Scenario: Fetch with unassigned tag returns error via explicit option
    Given a prompt with no tags assigned
    When I fetch the prompt using get(handle, { tag: "production" })
    Then I receive an error

  @e2e
  Scenario: Create custom tag, assign it, and fetch by it
    Given I create a custom tag "canary" via the SDK
    And I create a prompt with two versions via the SDK
    When I assign the "canary" tag to version 2
    And I fetch the prompt using get("handle:canary")
    Then I receive version 2 config data

  @e2e
  Scenario: List tags includes a newly created custom tag
    Given I create a custom tag "canary" via the SDK
    When I list all tags via the SDK
    Then the response includes "canary" alongside the built-in tags

  @e2e
  Scenario: Delete custom tag removes it from the list
    Given I create a custom tag "canary" via the SDK
    When I delete the "canary" tag via the SDK
    And I list all tags via the SDK
    Then the response does not include "canary"
