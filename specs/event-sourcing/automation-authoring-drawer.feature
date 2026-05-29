Feature: Staged automation authoring

  A user creates and edits an automation through a single drawer of collapsible
  stages. The drawer reveals each stage as the previous one is completed, so the
  surface stays small whether the automation is a notification (Slack, email) or
  an action (add to dataset, add to annotation queue). The same drawer edits an
  existing automation, with every stage pre-filled.

  This replaces the previously separate create drawer, "customize message" form,
  and template editor. See dev/docs/adr/028-staged-automation-authoring-drawer.md.

  Background:
    Given a user authoring an automation in a project

  Rule: The drawer reveals stages progressively

    Scenario: A new automation starts by choosing a category
      When the user opens the automation drawer
      Then the first stage asks whether this is a notification or an action
      And the later stages are not yet available

    Scenario: Choosing a category offers the matching types
      Given the user is creating an automation
      When the user chooses the notification category
      Then the type stage offers Slack and email
      When the user chooses the action category
      Then the type stage offers add-to-dataset and add-to-annotation-queue

    Scenario: A completed stage collapses to a summary and can be reopened
      Given the user has chosen a category and a type
      When the user moves to the next stage
      Then the earlier stages collapse to a one-line summary
      And the user can reopen any earlier stage to change it

    Scenario: Changing the type clears configuration that no longer applies
      Given the user has configured an email notification
      When the user changes the type to Slack
      Then the email configuration is cleared
      And the Slack configuration stage is shown empty

  Rule: Conditions decide when the automation fires

    Scenario: An automation created from settings requires a condition
      Given the user opened the drawer from automation settings
      When the user tries to save without any condition
      Then saving is blocked until at least one condition is set

    Scenario: An automation created from the traces view pre-fills the conditions
      Given the user opened the drawer from a filtered traces view
      When the conditions stage is shown
      Then it is pre-filled with the active trace filters

  Rule: Notifications configure a template; actions configure a destination

    Scenario: An email notification configures recipients and templates
      Given the user is configuring an email notification
      Then the user sets the recipients, the subject template, and the body template

    Scenario: A Slack notification configures a webhook and a message template
      Given the user is configuring a Slack notification
      Then the user sets the webhook and the message template

    Scenario: A dataset action configures the destination only
      Given the user is configuring an add-to-dataset action
      Then the user selects the target dataset
      And no template stage is shown

  Rule: Cadence applies only to notifications

    Scenario: The cadence stage is hidden for actions
      Given the user is authoring an add-to-dataset action
      Then no cadence stage is shown

    Scenario: The cadence stage is shown but not yet editable for notifications
      Given the user is authoring an email notification
      Then a cadence stage is shown
      But it cannot be edited yet

  Rule: The author can preview and test before saving

    Scenario: The preview renders the in-progress template against example data
      Given the user is editing a notification template that has not been saved
      When the preview renders
      Then it shows the template rendered against example automation data

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
      Given the user has completed every required stage
      When the user saves
      Then the automation is created and appears in the automation list

    Scenario: An invalid template blocks saving
      Given the user has written a template with invalid syntax
      When the user saves
      Then saving is blocked with the template error

    Scenario: Abandoning the drawer persists nothing
      Given the user has partially configured a new automation
      When the user closes the drawer without saving
      Then no automation is created

  Rule: Editing reuses the same staged drawer

    Scenario: Editing an existing automation pre-fills every stage
      Given an existing email automation
      When the user edits it
      Then the same staged drawer opens with the category, type, conditions, configuration, and templates pre-filled
