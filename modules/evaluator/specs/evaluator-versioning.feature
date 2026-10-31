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

  @unit
  Scenario: An unattributed credential cannot bypass the deploy check
    Given a request whose only actor is an internal proof actor, such as an ownerless project key
    When its caller is resolved for a version write or a delete
    Then it is unattributed and holds no deploy permission
    And a named system actor still runs without the check

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
  Scenario: The TypeScript SDK reads an evaluator at a label and moves its labels
    Given the SDK's evaluators service
    When it gets an evaluator with { label: "production" } or { version: 2 }
    Then it calls GET /api/v1/evaluators/idOrSlug with that label or version in the query
    And listVersions, assignLabel and removeLabel call the versions and labels routes

  @unit
  Scenario: The Python SDK reads an evaluator at a label and moves its labels
    Given the Python SDK's evaluators client
    When it gets an evaluator with label="production" or version=2
    Then the request carries that label or version as a query parameter
    And list_versions, assign_label and remove_label call the versions and labels routes

  @unit
  Scenario: The CLI lists an evaluator's versions and deploys a label
    When a user runs "langwatch evaluator versions <idOrSlug>"
    Then the versions are printed newest first with their labels
    When a user runs "langwatch evaluator deploy <idOrSlug> production --version 2"
    Then production points at version 2
    And without --version the label points at the latest version
    When a user runs "langwatch evaluator undeploy <idOrSlug> production"
    Then the label is removed

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

  @unit
  Scenario: A monitor refuses a label name the evaluator label rules refuse
    When a monitor is saved pinned to "latest", a number or a malformed name
    Then the save is refused with the label rule it breaks

  @unit
  Scenario: A guardrail pinned to a label runs that evaluator version
    Given a gateway guardrail monitor on an evaluator, pinned to the label "production"
    And the evaluator's production settings differ from the monitor's own settings
    When the gateway lists the enabled guardrail monitors
    Then the monitor carries the production settings
    And a guardrail monitor with no label carries its own settings

  # --- Backfill ---

  @unit
  Scenario: Existing evaluators get version 1 from their current settings
    Given evaluators created before versions existed
    When the background step "evaluator:backfill-versions" runs
    Then each evaluator has version 1 holding its current settings
    And its creator is read from its earliest "evaluators.create" audit entry
    And a second run writes nothing

  @integration
  Scenario: A legacy evaluator's first save keeps its old settings as version 1
    Given an evaluator created before versions existed
    When it is saved before the backfill reaches it
    Then version 1 holds the settings it had before the save
    And version 2 holds the saved settings

  # --- UI ---

  @integration
  Scenario: The evaluator drawer shows versions and opens the deploy dialog
    Given an evaluator with versions 1 and 2
    When the user opens its version history
    Then the versions are listed newest first with author, date and labels
    And "Deploy" opens a dialog with latest, production and staging rows

  @integration
  Scenario: A failed label save shows the registered error and reads the labels again
    Given the deploy dialog is open for an evaluator
    When saving a label is refused by the server
    Then the dialog stays open and shows the error's registered copy, never its code
    And the evaluator's labels are read again so a retry starts from what was saved

  @integration
  Scenario: The deploy dialog adds a custom label and refuses a reserved one
    Given the deploy dialog is open for an evaluator with versions 1 and 2
    When the user adds a label named "latest" or a number
    Then the dialog explains why the name is refused and the label cannot be added
    And Escape closes the label input but leaves the dialog open
    When the user adds "canary", points it at version 1 and saves
    Then "canary" is assigned to version 1

  @integration
  Scenario: The online evaluation drawer picks the evaluator deploy label
    Given an online evaluation on an evaluator with "production" on version 1 and latest version 2
    When the user opens the online evaluation drawer
    Then the deploy label picker shows "latest" by default
    And picking "production" saves the online evaluation pinned to "production"

  @integration
  Scenario: The evaluators list shows who created each evaluator
    Given an evaluator created by "Ada" and one created before creators were recorded
    When the evaluators screen lists them
    Then the first shows "Created by Ada"
    And the second shows no creator
