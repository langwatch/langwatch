Feature: CLI Prompt Tag Commands
  As a developer using LangWatch from the terminal
  I want to manage prompt tags via CLI commands
  So that I can control deployment slots (production, staging, etc.) without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  # --- SDK: renameTag method ---

  @unit
  Scenario: renameTag calls PUT /api/prompts/tags/{tag} with new name
    When I call promptsApiService.renameTag({ tag: "old-name", name: "new-name" })
    Then the SDK sends PUT /api/prompts/tags/old-name with body { name: "new-name" }

  @unit
  Scenario: Facade tags.rename delegates to renameTag
    When I call facade.tags.rename("old-name", "new-name")
    Then it delegates to promptsApiService.renameTag({ tag: "old-name", name: "new-name" })

  # --- tag list ---

  @unit
  Scenario: List tags displays a formatted table
    Given the org has tags "latest", "production", "staging", and "canary"
    When I run "langwatch prompt tag list"
    Then I see a table with columns Name and Created
    And all four tags are listed

  @unit
  Scenario: List tags when none exist
    Given the org has no custom tags
    When I run "langwatch prompt tag list"
    Then I see "No custom tags found. The 'latest' tag is always available."

  @unit
  Scenario: List tags exits 1 on API error
    Given the API returns an error for listTags
    When I run "langwatch prompt tag list"
    Then the command exits with code 1

  # --- tag create ---

  @unit
  Scenario: Create a custom tag
    When I run "langwatch prompt tag create canary"
    Then the SDK calls createTag with name "canary"
    And I see "Created tag: canary"

  @unit
  Scenario: Create tag with invalid name exits 1 without calling API
    When I run "langwatch prompt tag create INVALID_NAME!"
    Then I see an error about invalid tag name format
    And createTag is not called
    And the command exits with code 1

  @unit
  Scenario: Create duplicate tag surfaces API error
    Given a tag "canary" already exists
    When I run "langwatch prompt tag create canary"
    Then I see an error from the API
    And the command exits with code 1

  # --- tag rename ---

  @unit
  Scenario: Rename a tag
    When I run "langwatch prompt tag rename canary beta"
    Then the SDK calls renameTag with tag "canary" and name "beta"
    And I see "Renamed tag: canary -> beta"

  @unit
  Scenario: Rename tag with invalid new name exits 1
    When I run "langwatch prompt tag rename canary INVALID!"
    Then I see an error about invalid tag name format
    And renameTag is not called
    And the command exits with code 1

  # --- tag assign ---

  @unit
  Scenario: Assign tag to latest version when no --version given
    Given "my-prompt" latest version has versionId "cm_abc123"
    When I run "langwatch prompt tag assign my-prompt production"
    Then the SDK fetches the prompt to resolve the versionId
    And calls assignTag with id "my-prompt", tag "production", versionId "cm_abc123"
    And I see confirmation of the assignment

  @unit
  Scenario: Assign tag to specific version
    Given "my-prompt" version 3 has versionId "cm_def456"
    When I run "langwatch prompt tag assign my-prompt production --version 3"
    Then the SDK fetches version 3 to resolve the versionId
    And calls assignTag with id "my-prompt", tag "production", versionId "cm_def456"

  @unit
  Scenario: Assign tag to nonexistent prompt exits 1
    Given "nonexistent" prompt does not exist
    When I run "langwatch prompt tag assign nonexistent production"
    Then I see an error that the prompt was not found
    And the command exits with code 1

  # --- tag delete ---

  @unit
  Scenario: Delete tag with confirmation
    When I run "langwatch prompt tag delete canary" and type "canary" to confirm
    Then the SDK calls deleteTag with "canary"
    And I see "Deleted tag: canary"

  @unit
  Scenario: Delete tag aborted on confirmation mismatch
    When I run "langwatch prompt tag delete canary" and type "wrong" to confirm
    Then deleteTag is not called
    And I see "Aborted"
    And the command exits with code 0

  @unit
  Scenario: Delete tag with --force skips confirmation
    When I run "langwatch prompt tag delete canary --force"
    Then deleteTag is called without prompting for confirmation
    And I see "Deleted tag: canary"

  # --- pull --tag ---

  @unit
  Scenario: Pull prompts by tag instead of version
    Given prompts.json has "my-prompt" tracked as a remote dependency
    When I run "langwatch prompt pull --tag production"
    Then the SDK fetches each prompt using { tag: "production" } instead of version
    And I see the pull result referencing the tag

  @unit
  Scenario: Pull --tag overrides version spec in prompts.json
    Given prompts.json has "my-prompt" pinned to version 2
    When I run "langwatch prompt pull --tag staging"
    Then the SDK fetches using { tag: "staging" }, ignoring the version spec

  @unit
  Scenario: Pull --tag with missing tag on server exits 1
    Given the "nonexistent" tag is not assigned to "my-prompt"
    When I run "langwatch prompt pull --tag nonexistent"
    Then I see an error for that prompt
    And the command exits with code 1

  # --- Command registration ---

  @unit
  Scenario: Help shows tag subcommand group
    When I run "langwatch prompt tag --help"
    Then I see subcommands: list, create, rename, assign, delete

  @unit
  Scenario: Tag subcommands appear in prompt help
    When I run "langwatch prompt --help"
    Then I see "tag" listed as a subcommand

  # --- Tag display in prompt list / get / versions ---

  @unit
  Scenario: Prompt list renders a Tags column including the built-in latest tag
    Given "my-prompt" has "production" pointing to its latest version and "staging" pointing to an older version
    When I run "langwatch prompt list"
    Then I see the row for "my-prompt" with a Tags column containing "latest, production"
    And the Tags column does not include tags pointing to older versions for the latest row

  @unit
  Scenario: Prompt list shows latest tag even when no custom tags exist
    Given "my-prompt" has no custom tag assignments
    When I run "langwatch prompt list"
    Then the row for "my-prompt" shows "latest" in the Tags column

  @unit
  Scenario: Prompt list JSON format includes tags array with latest plus customs
    Given "my-prompt" has "production" pointing to its latest version
    When I run "langwatch prompt list --format json"
    Then the JSON for "my-prompt" includes a tags array with { name: "latest" } and { name: "production" }

  @unit
  Scenario: Prompt versions renders a Tags column per version
    Given "my-prompt" has "production" on v3 and "staging" on v2
    When I run "langwatch prompt versions my-prompt"
    Then the row for v3 shows "latest, production" in the Tags column
    And the row for v2 shows "staging" in the Tags column
    And the row for v1 shows "—"

  @unit
  Scenario: Prompt versions JSON format includes tags array on each version
    Given "my-prompt" has "production" on v2 and "staging" on v3
    When I run "langwatch prompt versions my-prompt --format json"
    Then each version in the JSON array includes a tags field
    And the latest version's tags include a { name: "latest" } entry

  @integration
  Scenario: API get returns latest plus custom tags on the latest version
    Given a prompt with "production" assigned to its latest version
    When I GET /api/prompts/:id
    Then the response tags array contains { name: "latest", versionId } and { name: "production", versionId }

  @integration
  Scenario: API get with ?tag=staging omits the latest tag for a non-latest version
    Given a prompt with "staging" assigned to an older version
    When I GET /api/prompts/:id?tag=staging
    Then the response tags array contains only { name: "staging", versionId } (no latest)

  @integration
  Scenario: API versions marks the latest row with the latest tag
    Given a prompt with "production" on the latest version and "staging" on an older one
    When I GET /api/prompts/:id/versions
    Then the latest row's tags include { name: "latest" } and { name: "production" }
    And older rows do not include { name: "latest" }

  @integration
  Scenario: API list returns latest plus any custom tags on the latest version
    Given a prompt with "production" on its latest version
    When I GET /api/prompts
    Then the entry's tags array contains { name: "latest" } and { name: "production" }
