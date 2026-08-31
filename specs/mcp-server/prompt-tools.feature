Feature: MCP Prompt Tools
  As a coding agent
  I want to manage prompts via the MCP server
  So that I can view and update prompt configurations programmatically

  # Scenarios below bind issue #5666 (langwatch/langwatch). Most are unit
  # tests on the MCP renderer/handler functions (handleGetPrompt,
  # handleUpdatePrompt), expected in
  # `mcp/typescript/src/__tests__/prompts.unit.test.ts` (new file, mirrors
  # datasets.unit.test.ts). @integration scenarios (merge-preservation and
  # the tag-to-version regression guard) stay in
  # `mcp/typescript/src/__tests__/all-tools.integration.test.ts`.

  Background:
    Given the MCP server is configured with a valid API key

  # --- Read path: platform_get_prompt (issue #5666 AC1-4) ---

  @unit
  Scenario: Rendering every field that changes how the prompt is called
    Given the returned version has parameters, inputs, outputs, model, temperature, maxTokens, and responseFormat all set
    When the agent calls platform_get_prompt
    Then the response renders a heading for each of parameters, inputs, outputs, model, temperature, maxTokens, and responseFormat
    And every parameter, input, and output name and type renders as readable text
    And the literal string "[object Object]" appears nowhere in the response

  @unit
  Scenario: Omitting headings for fields absent from the API response
    Given the returned version has none of parameters, inputs, outputs, model, temperature, maxTokens, or responseFormat set
    When the agent calls platform_get_prompt
    Then the response renders no heading for any of those fields
    And the literal string "[object Object]" appears nowhere in the response

  @unit
  Scenario: Rendering the pinned version's fields when version pins an older one
    Given a prompt whose older version has parameters, inputs, outputs, model, temperature, maxTokens, and responseFormat set
    When the agent calls platform_get_prompt with version pinned to that older version
    Then the response renders headings for the pinned version's fields, not the latest version's
    And every parameter, input, and output name and type renders as readable text
    And the literal string "[object Object]" appears nowhere in the response

  @unit
  Scenario: Listing tags currently assigned to the returned version
    Given a prompt version tagged "production" and "staging"
    When the agent calls platform_get_prompt
    Then the response lists "production" and "staging" as deployments of the returned version

  # AC2 was narrowed to forbid implying global deployment state: a tag absent
  # from the returned version must read as "not assigned to this version",
  # never as "not deployed" anywhere.
  @unit
  Scenario: Never implying a tag is undeployed everywhere when it is only absent from this version
    Given a prompt version with no tags, while an older version of the same prompt is tagged "production"
    When the agent calls platform_get_prompt
    Then the response states "production" is not assigned to the returned version
    And the response does not say "production" is undeployed

  @unit
  Scenario: Rendering an empty deployments section when the version carries only the built-in latest tag
    Given a prompt version tagged only with the built-in "latest" tag
    When the agent calls platform_get_prompt
    Then the response renders an empty deployments section
    And the response contains no text claiming the prompt is not deployed anywhere

  @unit
  Scenario: Listing a custom tag as a deployment
    Given a prompt version tagged with the custom tag "canary"
    When the agent calls platform_get_prompt
    Then the response lists "canary" as a deployment of the returned version

  @unit
  Scenario: Including the returned version's versionId
    Given a prompt version exists
    When the agent calls platform_get_prompt
    Then the response includes that version's versionId

  @unit
  Scenario: Requesting the unabridged API payload via format json
    Given a prompt version exists
    When the agent calls platform_get_prompt with format "json"
    Then the response parses as the full platform_get_prompt API payload

  @unit
  Scenario: Defaulting to the digest format when format is omitted
    Given a prompt version exists
    When the agent calls platform_get_prompt without a format argument
    Then the response is the rendered digest, not the raw API payload

  @unit
  Scenario: Documenting the format parameter on the registered tool schema
    When the agent inspects the platform_get_prompt tool's registered input schema and description
    Then the schema exposes a format parameter accepting "digest" or "json"
    And the description documents what the format parameter does

  # --- Write path: platform_update_prompt (issue #5666 AC5-9) ---

  @unit
  Scenario: Deriving tag and deployment state from the server response, not the request
    Given an update request whose tags differ from what the server actually applies
    When the agent calls platform_update_prompt
    Then the response reflects the tags the server applied, not the tags the request asked for

  # AC6's evidence text lists two overlapping case sets (request-shape cases
  # and prior-tag-state cases); the two scenarios below cover their union by
  # giving the "no tags" case both a production and a staging tag already
  # stale on the prior version, and both assert no line mixes a version
  # number with a deployment tag name.
  @unit
  Scenario: Reporting a new version as not deployed and existing deployments as untouched
    Given a prompt whose latest version is tagged "production" and "staging"
    When the agent calls platform_update_prompt without tags
    Then the response states the new version is not deployed
    And the response states "production" and "staging" were left untouched
    And no single response line contains both a version number and a deployment tag name

  @unit
  Scenario: Using the word deployed only when a tag was actually assigned
    Given a prompt exists
    When the agent calls platform_update_prompt with tags ["production"]
    Then the response says the new version is deployed to "production"
    And no single response line contains both a version number and a deployment tag name

  @unit
  Scenario: Assigning a tag that did not previously exist on the prompt
    Given a prompt with no existing tags
    When the agent calls platform_update_prompt with tags ["canary"]
    Then the response says the new version is deployed to "canary"

  @unit
  Scenario: Never presenting the built-in latest tag as a deployment after an update
    Given a prompt update whose server response carries only the built-in "latest" tag
    When the agent calls platform_update_prompt
    Then the response's deployments section is absent or explicitly empty
    And the response does not list "latest" as a deployment

  @unit
  Scenario: Including the new version's versionId
    Given a prompt update that creates a new version
    When the agent calls platform_update_prompt
    Then the response includes the new version's versionId

  # AC8: the server commits the new version before assigning tags, so a
  # rejected tag assignment leaves a real, untagged version behind and the
  # failure response carries no versionId. The tool must re-fetch and match
  # on commitMessage rather than trust anything from the failed call.
  @unit
  Scenario: Reporting a version as created but untagged when tag assignment fails and a matching version is found
    Given platform_update_prompt is called with tags and the server rejects the tag assignment
    And a re-fetch of the prompt finds a version whose commitMessage matches the request's commitMessage
    When the agent calls platform_update_prompt
    Then the response reports that version as created and untagged
    And the response includes that version's versionId
    And the response states which tag assignment failed

  @unit
  Scenario: Reporting a plain failure when tag assignment fails and no matching version is found
    Given platform_update_prompt is called with tags and the server rejects the tag assignment
    And a re-fetch of the prompt finds no version whose commitMessage matches the request's commitMessage
    When the agent calls platform_update_prompt
    Then the response reports a plain failure
    And the response includes no versionId

  # --- Write path continued: field carry-forward and tag stability (issue #5666 AC10-11) ---

  @integration
  Scenario: Carrying forward prior fields when an update supplies only messages and a commit message
    Given a prompt version with parameters, inputs, outputs, temperature, and responseFormat set
    When the agent calls platform_update_prompt with only messages and commitMessage
    Then the new version retains the prior version's parameters, inputs, outputs, temperature, and responseFormat

  @integration
  Scenario: Tag-to-version mapping stays unchanged when an update omits tags
    Given a prompt with "production" tagged on version N
    When the agent calls platform_update_prompt without tags, creating version N+1
    Then "production" still points at version N
    And the tag-to-version mapping is unchanged

  @integration
  Scenario: Passing tags explicitly moves the tag to the new version
    Given a prompt with "production" tagged on version N
    When the agent calls platform_update_prompt with tags ["production"], creating version N+1
    Then "production" now points at version N+1

  # --- Supporting contract: typed response interfaces (issue #5666 AC12) ---

  @unit
  Scenario: Declaring every rendered field on the typed response interfaces
    Given a PromptDetailResponse fixture with parameters, inputs, outputs, temperature, maxTokens, responseFormat, tags, and versionId all set
    And a PromptMutationResponse fixture with tags and versionId set
    When the renderers read those fixtures directly, with no cast
    Then pnpm typecheck passes
