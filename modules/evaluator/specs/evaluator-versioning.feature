Feature: Evaluator versions and deploy labels
  As a LangWatch user
  I want every change to an evaluator kept as a numbered version, and labels like
  production and staging pointing at the version each caller runs
  So that monitors and the evaluation API keep running a known version while I edit

  The evaluator row stays the latest version, so every reader that names no label or
  version keeps reading what it read before. Labels follow the prompt tag rules.

  # --- Versions ---

  @unit
  Scenario: Creating an evaluator records version 1
    When a user creates an evaluator "Toxicity"
    Then the evaluator has version 1 authored by that user
    And the evaluator records that user as its creator and last updater

  @unit
  Scenario: Every update appends a version and keeps the head as latest
    Given an evaluator "Toxicity" at version 1
    When a user changes its settings with the commit message "Raise the threshold"
    Then the evaluator has versions 1 and 2, newest first
    And version 2 carries the new settings, the commit message and the user as author
    And reading the evaluator with no label or version returns the version 2 settings

  @unit
  Scenario: An update that changes nothing writes no version
    Given an evaluator "Toxicity" at version 1
    When an update sends the same name and settings
    Then the evaluator still has only version 1

  # --- Labels ---

  @unit
  Scenario: Deploying a label points it at a version
    Given an evaluator with versions 1, 2 and 3
    When a user with "evaluators:deploy" assigns "production" to version 2
    Then reading the evaluator with label "production" returns the version 2 settings
    And the versions list shows "production" on version 2

  @unit
  Scenario: Label names follow the prompt tag rules
    When a user assigns the label "latest" to a version
    Then it is refused with code "evaluator_label_invalid"

  @unit
  Scenario: Asking for a label that points nowhere is refused
    When a caller reads an evaluator with the label "staging" that is not assigned
    Then it is refused with code "evaluator_version_not_found"

  @unit
  Scenario: The slug shorthand picks a label or a version
    Given an evaluator "toxicity" whose "production" label points at version 2
    When the evaluation API resolves "toxicity:production" for execution
    Then the version 2 settings are used
    When it resolves "toxicity:1"
    Then the version 1 settings are used
    When it resolves "toxicity"
    Then the latest settings are used

  # --- Protection ---

  @integration
  Scenario: Moving a label needs the deploy permission
    Given a user whose custom role holds "evaluations:manage" but not "evaluators:deploy"
    When they assign "production" through the tRPC procedure or the REST route
    Then the request is refused before the handler runs with code "permission_denied"

  @unit
  Scenario: Deleting a labelled evaluator needs the deploy permission
    Given an evaluator whose "production" label points at version 1
    And a caller without "evaluators:deploy"
    When the caller deletes the evaluator
    Then it is refused with code "evaluator_deployed_label_protected" naming the label
    And the evaluator is not archived

  @unit
  Scenario: A caller with the deploy permission deletes a labelled evaluator
    Given an evaluator whose "production" label points at version 1
    And a caller holding "evaluators:deploy"
    When the caller deletes the evaluator
    Then the evaluator is archived

  # --- Readers ---

  @integration
  Scenario: REST reads an evaluator by label or version
    Given an evaluator whose "production" label points at version 1 and whose latest is version 2
    When a client calls GET /api/v1/evaluators/:idOrSlug?label=production
    Then the response carries the version 1 settings and "version": 1
    When a client calls GET /api/v1/evaluators/:idOrSlug:2
    Then the response carries the version 2 settings

  @unit
  Scenario: A monitor pinned to a label runs that evaluator version
    Given a monitor on an evaluator, pinned to the label "production"
    And the evaluator's latest settings differ from its production settings
    When the monitor is read for an evaluation
    Then its evaluator carries the production settings
    And a monitor with no label carries the latest settings

  @unit
  Scenario: A monitor pinned to a label that was removed keeps running latest
    Given a monitor pinned to "staging" on an evaluator with no "staging" label
    When the monitor is read for an evaluation
    Then its evaluator carries the latest settings

  # --- Backfill ---

  @unit
  Scenario: Existing evaluators get version 1 from their current settings
    Given evaluators created before versions existed
    When the background step "evaluator:backfill-versions" runs
    Then each evaluator has version 1 holding its current settings
    And its creator is read from its earliest "evaluators.create" audit entry
    And a second run writes nothing

  # --- UI ---

  @integration
  Scenario: The evaluator drawer shows versions and opens the deploy dialog
    Given an evaluator with versions 1 and 2
    When the user opens its version history
    Then the versions are listed newest first with author, date and labels
    And "Deploy" opens a dialog with latest, production and staging rows

  @integration
  Scenario: The evaluators list shows who created each evaluator
    Given an evaluator created by "Ada" and one created before creators were recorded
    When the evaluators screen lists them
    Then the first shows "Created by Ada"
    And the second shows no creator
