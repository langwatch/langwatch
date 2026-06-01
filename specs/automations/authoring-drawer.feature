Feature: Staged automation authoring drawer

  A user creates and edits an automation through a single drawer of section
  rows that open into secondary drawers. The drawer reveals each section as
  the previous one is completed, so the surface stays small whether the
  automation is a notification (Slack, email) or an action (add to dataset,
  add to annotation queue). The same drawer edits an existing automation,
  with every section pre-filled.

  This replaces the previously separate create drawer, "customize message"
  form, and template editor. The template-authoring sub-flow (live preview,
  test fire) is reachable inside the Configuration secondary drawer for
  notification types.

  See dev/docs/adr/026-automation-operator-surfaces.md.

  Background:
    Given a user authoring an automation in a project

  Rule: The drawer reveals sections progressively

    Scenario: A new automation starts at identity, then picks a type
      When the user opens the automation drawer
      Then the identity row (name + alert type) is visible at the top
      And the When section is visible
      And the type picker is visible
      And Setup, Cadence, and Test sections are not yet available

    Scenario: Choosing a category offers the matching types
      Given the user is creating an automation
      When the user opens the type picker
      Then the picker offers Slack and email under Notification
      And the picker offers add-to-dataset and add-to-annotation-queue under Action

    Scenario: A completed section collapses to a one-line summary
      Given the user has chosen a type and configured a destination
      When the user returns to the main drawer pane
      Then earlier sections show a one-line summary of their state
      And the user can reopen any section to change it

    Scenario: Changing the type clears configuration that no longer applies
      Given the user has configured an email notification
      When the user changes the type to Slack
      Then the email-specific configuration is cleared
      And the Slack configuration secondary opens empty

  Rule: Conditions decide when the automation fires

    Scenario: An automation created from settings requires a condition
      Given the user opened the drawer from automation settings
      When the user tries to save without any condition
      Then saving is blocked until at least one condition is set

    Scenario: An automation created from the traces view pre-fills the conditions
      Given the user opened the drawer from a filtered traces view
      When the When section is shown
      Then it is pre-filled with the active trace filters

  Rule: Notifications configure templates; actions configure destinations

    Scenario: An email notification configures recipients and templates
      Given the user is configuring an email notification
      Then the user sets the recipients, the subject template, and the body template

    Scenario: Email recipients outside the team are allowed but marked
      Given the user is configuring an email notification
      When the user adds "alerts@partner.com" as a recipient
      Then the recipient is accepted
      And it is shown with an "External" warning badge

    Scenario: A Slack notification configures a webhook and a message template
      Given the user is configuring a Slack notification
      Then the user sets the webhook and the message template

    Scenario: A dataset action configures the destination only
      Given the user is configuring an add-to-dataset action
      Then the user selects the target dataset
      And no template section is shown

  Rule: Cadence and debounce apply per trigger

    Scenario: The cadence section is hidden for action triggers
      Given the user is authoring an add-to-dataset action
      Then no cadence section is shown
      And the traceDebounceMs field is still available inside the cadence-equivalent surface

    Scenario: The cadence section is shown for notification triggers
      Given the user is authoring an email notification
      Then the cadence section is available
      And it exposes the notificationCadence dropdown
      And it exposes the traceDebounceMs setting

    Scenario: Cadence defaults to a 5-minute digest for new notifications
      Given the user is creating a new email automation
      When the cadence section opens
      Then the cadence is "Every 5 minutes" by default

  Rule: The author can preview templates and test fire before saving

    Scenario: Opening the template editor for a trigger with no custom templates
      Given the user is configuring a notification with no custom templates
      Then the email subject, email body, and Slack fields show the framework defaults
      And a list of the variables a template can reference is shown

    Scenario: Editing the email body updates the live preview
      Given the user is editing the email body template
      When the user changes the template text
      Then the preview shows the body rendered to HTML against sample data

    Scenario: A template referencing a missing variable previews with a warning
      Given the user writes a template referencing a variable the context does not provide
      When the preview renders
      Then the missing variable renders as empty in the preview
      And the operator is warned which variable names were missing

    Scenario: A Block Kit template previews as rendered blocks and opens in the Builder
      Given the user selects the Block Kit Slack template type
      And writes a template that renders valid Block Kit JSON
      When the preview renders
      Then the allowed blocks are shown rendered in-app
      And the operator can open the same blocks in the Slack Block Kit Builder

    Scenario: Interactive blocks are dropped from the Block Kit preview
      Given the user writes a Block Kit template containing an interactive actions block
      When the preview renders
      Then the interactive block is not shown in the preview

    Scenario: Invalid Block Kit JSON previews as the default with a warning
      Given the user writes a Block Kit template whose output is not valid JSON
      When the preview renders
      Then the default Slack notification is previewed instead
      And the operator is warned that the template fell back to the default

    Scenario: Test fire sends a banner-marked notification before saving
      Given the user has configured a notification with a destination
      When the user test-fires the automation before saving it
      Then a notification is delivered to the configured destination
      And it is unmistakably marked as a test fire

    Scenario: Test fire is unavailable until a destination is configured
      Given the user has not yet set a destination
      Then test fire is unavailable

  Rule: Saving persists the whole automation at once

    Scenario: Saving a fully configured automation creates it
      Given the user has completed every required section
      When the user saves
      Then the automation is created and appears in the automation list

    Scenario: An invalid template blocks saving
      Given the user has written a template with invalid syntax
      When the user saves
      Then saving is blocked with the template error
      And no template change is persisted

    Scenario: Abandoning the drawer persists nothing
      Given the user has partially configured a new automation
      When the user closes the drawer without saving
      Then no automation is created

  Rule: Editing reuses the same staged drawer

    Scenario: Editing an existing automation pre-fills every section
      Given an existing email automation
      When the user edits it
      Then the same staged drawer opens with the identity, conditions, configuration, cadence, debounce, and templates pre-filled

  Rule: The settings list shows dispatch health

    Scenario: Last triggered and fired-count are available immediately
      Given automations exist in a project
      When the user opens the automation settings list
      Then each row shows the last-triggered timestamp and total fired count
      And the values come from the TriggerSent claim ledger

    Scenario: Pending and failed counts appear once outbox-backed dispatch is live
      Given outbox-backed notify dispatch is wired in this environment
      When the user opens the automation settings list
      Then each notification row shows pending, failed, and dead counts
      And the counts come from grouping ReactorOutbox rows by status

    Scenario: Template-health warnings surface on the per-automation panel
      Given a notification dispatched with a custom template that fell back to the default
      When the user opens the automation's detail panel
      Then the panel shows the template-error warning
      And the panel shows any missing variable names from that dispatch
