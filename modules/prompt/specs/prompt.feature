Feature: Prompt service
  Prompt owns versioned prompt configurations and their custom tags.

  @unit
  Scenario: invalid handles are rejected at the contract boundary
    When a caller creates a prompt with an invalid handle
    Then the Prompt contract rejects the command before persistence

  @integration
  Scenario: prompt versions remain part of one Prompt service
    Given a prompt has multiple versions
    When a caller requests its versions
    Then the Prompt service returns the version history

  @integration
  Scenario: existing transports preserve their public surface
    When a caller uses tRPC or the REST prompt API
    Then the request delegates to the process-owned Prompt service
    And the existing procedure names and /api/prompts paths remain unchanged

  @unit
  Scenario: prompt tags remain subordinate behaviour
    When a caller creates or renames a prompt tag
    Then the Prompt service applies the organization scope
    And no separate tag feature or repository is created

  @unit
  Scenario: trace metadata uses the Prompt contract
    Given SDK span attributes describe a Prompt handle, version, tag, or variables
    When Trace reads the Prompt metadata
    Then the Prompt contract interprets the attributes consistently
    And Trace retains ownership of locating the reference in a trace

  # PARKED, NOT BUILT. The premise is a referential check the database does not
  # make: `packages/prisma-client/prisma/schema.prisma` sets
  # `relationMode = "prisma"`, so `LlmPromptConfigVersion.author` emits no
  # foreign key and a version written for an unknown author is accepted. Making
  # this scenario true means adding an author-existence read to every version
  # write, which is a product decision rather than a binding.
  @integration @unimplemented
  Scenario: A rejected version write leaves the prompt on its last good version
    Given a prompt whose only version is the one it was created with
    When a new version is written for an author the database does not hold
    Then the write is rejected
    And the prompt still reads back at the version and text it already had

  @unit
  Scenario: Prompt Studio persists its open tabs through the storage it is handed
    Given the application hands Prompt Studio a key-value store of its own
    When a person opens a prompt tab, edits it and closes it
    Then every read and write goes to the store the application handed it
    And Prompt Studio touches no browser storage of its own

  @unit @integration
  Scenario: Prompt tabs keep their layout and prompt ids, never their contents
    Given a prompt tab holding span messages, form values and variables
    When the tab layout is persisted
    Then only the layout and each tab's prompt id, title, version and scope are kept
    And a tab with no saved prompt is not kept
    And on reload each kept tab reads its prompt again at the kept version

  @integration
  Scenario: Reloading with unsaved prompt changes asks first
    Given a prompt tab with changes that are not saved
    When the reader reloads or leaves the page
    Then the browser asks before unloading
    But a tab with nothing unsaved lets the page unload

  @integration
  Scenario: A promptId link opens that prompt in a new tab
    Given a link to the prompts page carrying ?promptId= of a saved prompt
    When the reader opens the link
    Then Prompt Studio reads that prompt and opens it in exactly one new tab

  @unit
  Scenario: a prompt created without a model takes the project's default model
    Given the project's default model for prompts is "openai/gpt-5.6-terra"
    When a caller creates a prompt that names no model
    Then the prompt's first version uses "openai/gpt-5.6-terra"

  @unit
  Scenario: a prompt created with a model never asks for the project's default
    When a caller creates a prompt that names "openai/gpt-5-mini"
    Then the prompt's first version uses "openai/gpt-5-mini"
    And the project's default model is not resolved

  @unit
  Scenario: a prompt field carrying a null byte is refused as a bad request
    Given a create, update or sync body whose text carries a null byte
    When the REST schema validates the body
    Then the body is refused as a validation error naming the field
    And no write reaches Postgres, which would answer 22021 as a 500

  @integration
  Scenario: a renamed prompt tag is listed under its new name
    Given the organization has a custom prompt tag
    When a caller renames it over the REST API
    Then the tag list shows the new name and no longer the old one

  @unit
  Scenario: a REST author who is not a user is refused
    Given the body names an authorId that matches no user
    When a prompt is created or updated over the REST API
    Then the write is refused as prompt_author_unknown with status 422

  @unit
  Scenario: a REST author without the write permission is refused
    Given the body names a user who lacks prompts:create or prompts:update on the project
    When a prompt is created or updated over the REST API
    Then the write is refused as prompt_author_unknown with status 422

  @unit
  Scenario: a REST author holding the write permission is accepted
    Given the body names a user who holds the permission on the project
    When a prompt is created or updated over the REST API
    Then the prompt is written with that author

  @unit
  Scenario: a REST write with no authorId is unchanged
    Given the body names no authorId
    When a prompt is created or updated over the REST API
    Then no author check runs and the prompt is written


  @unit
  Scenario: a new organization is seeded with the production and staging prompt tags
    Given organization records that an organization was created
    When prompt's peer subscriber handles the fact
    Then the organization has the production and staging prompt tags

  @unit
  Scenario: a redelivered creation fact seeds no prompt tag twice
    Given an organization already seeded with the production and staging prompt tags
    When the creation fact is delivered again
    Then the organization still has exactly one production and one staging tag

  @unit
  Scenario: The deploy backfill seeds prompt tags only for organizations with none
    Given one organization has no prompt tags and another holds only a custom tag
    When the tag backfill runs over both organizations twice
    Then the untagged organization has the production and staging prompt tags
    And the organization with a custom tag is left as it was
    And the second pass seeds nothing

  @unit
  Scenario: A dry run of the deploy backfill writes no prompt tag
    Given an organization has no prompt tags
    When the tag backfill runs over it as a dry run
    Then it reports the organization would be seeded
    And the organization still has no prompt tags

  @unit
  Scenario: A worker collects the tag backfill as an organization tenant step
    Given a worker installs prompt
    When the upgrade runner migrates one untagged organization through the collected step
    Then the step finalizes because the organization holds prompt tags

  @integration
  Scenario: A second version saved from the same dialog keeps its description
    Given the save-version dialog has saved one version and stays open
    When a second description is typed and saved
    Then the second save carries that description

  @integration
  Scenario: A prompt handle typed in the change-handle dialog is the one saved
    Given the change-handle dialog opened for a prompt with a handle
    When a new handle is typed and saved
    Then the save carries the new handle

  @integration
  Scenario: Typing then saving at once keeps the last characters
    Given the prompt editor with a template being typed
    When the editor loses focus right after the last keystroke
    Then the full typed text, including a closing "}}", reaches the form before the save reads it
