Feature: Authoring trigger notification templates

  An operator customises how a trigger's email and Slack notifications look by
  editing Liquid templates in an in-product editor. The editor shows the
  framework default as a starting point, previews the rendered result live, and
  lets the operator send a clearly-marked test notification before relying on it
  for real alerts.

  The authoring surface is the customer-facing companion to the rendering engine
  described in trigger-notification-templates.feature.

  See dev/docs/adr/026-liquid-templates-for-trigger-notifications.md.

  Background:
    Given a trigger that sends email and Slack notifications

  Rule: The editor starts from the framework default

    Scenario: Opening the editor for a trigger with no custom templates
      Given the trigger has no custom templates
      When the operator opens the template editor
      Then the email subject, email body, and Slack fields show the framework defaults
      And a list of the variables a template can reference is shown

  Rule: Saving validates the templates before persisting

    Scenario: Saving valid templates persists them to the trigger
      Given the operator has written a valid custom email body
      When the operator saves the template
      Then the custom email body is stored on the trigger
      And later notifications render from the custom template

    Scenario: Saving a syntactically invalid template is rejected
      Given the operator has written an email body with invalid Liquid syntax
      When the operator saves the template
      Then the save is rejected with the syntax error
      And no template change is persisted

  Rule: A live preview shows the rendered result while editing

    Scenario: Editing the email body updates the rendered preview
      Given the operator is editing the email body template
      When the operator changes the template text
      Then the email preview shows the body rendered to HTML with sample data

    Scenario: A template that references a missing variable is previewed with a warning
      Given the operator writes a template referencing a variable the context does not provide
      When the preview renders
      Then the missing variable renders as empty in the preview
      And the operator is warned which variable names were missing

  Rule: Slack Block Kit templates are previewed and openable in the Block Kit Builder

    Scenario: A Block Kit template is previewed as rendered blocks
      Given the operator selects the Block Kit Slack template type
      And writes a template that renders valid Block Kit JSON
      When the preview renders
      Then the allowed blocks are shown rendered in-app
      And the operator can open the same blocks in the Slack Block Kit Builder

    Scenario: Interactive blocks are dropped from the Block Kit preview
      Given the operator writes a Block Kit template containing an interactive actions block
      When the preview renders
      Then the interactive block is not shown in the preview

    Scenario: Block Kit output that is not valid JSON is previewed as the default
      Given the operator writes a Block Kit template whose output is not valid JSON
      When the preview renders
      Then the default Slack notification is previewed instead
      And the operator is warned that the template fell back to the default

  Rule: A test fire sends a clearly-marked notification

    Scenario: Test-firing an email sends a banner-marked message to the configured recipients
      Given the trigger is configured to email a recipient
      When the operator test-fires the trigger
      Then an email is sent to the configured recipient
      And the email is unmistakably marked as a test fire

    Scenario: Test-firing a Slack message posts a banner-marked message to the configured webhook
      Given the trigger is configured to post to a Slack webhook
      When the operator test-fires the trigger
      Then a message is posted to the configured webhook
      And the message is unmistakably marked as a test fire

    Scenario: Test-firing a trigger with no notification recipient is prevented
      Given the trigger has no email recipient or Slack webhook configured
      When the operator attempts to test-fire the trigger
      Then the test fire is prevented with an explanation
