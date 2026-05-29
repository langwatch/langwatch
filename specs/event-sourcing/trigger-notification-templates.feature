Feature: Liquid templates for trigger notifications

  Trigger email and Slack notifications render through a sandboxed Liquid
  template engine. A customer can supply their own subject line, email body
  (Markdown), and Slack message (plain text or Block Kit); when they supply
  nothing, the framework renders the same notification it always did.

  The template surface degrades gracefully: a template that throws, parses
  to invalid Block Kit, or references missing variables never breaks the
  dispatch — it falls back to the default and the operator sees why.

  The same template handles a single match and a digest of many matches,
  because every template iterates over a `matches` collection that holds one
  entry for an immediate dispatch and N entries for a digest.

  See dev/docs/adr/026-liquid-templates-for-trigger-notifications.md.

  Background:
    Given a trigger that matched one or more traces

  Rule: A trigger with no custom templates renders the framework default

    Scenario: Default email is rendered when no email templates are set
      Given the trigger has no custom subject or body template
      When the email notification is rendered
      Then the subject names the trigger and its alert type
      And the body lists each matched trace with a link

    Scenario: Default Slack message is rendered when no Slack template is set
      Given the trigger has no custom Slack template
      When the Slack notification is rendered
      Then the message names the trigger and links to each matched trace

  Rule: A customer Liquid template controls the rendered output

    Scenario: A custom subject interpolates trigger and project variables
      Given the trigger has a custom subject template referencing the project name and alert type
      When the email subject is rendered
      Then the rendered subject contains the project name and alert type

    Scenario: A custom email body is written in Markdown and rendered to HTML
      Given the trigger has a custom body template that emits Markdown headings and a link
      When the email body is rendered
      Then the body is valid HTML with the heading and link preserved

    Scenario: An over-long subject is clipped
      Given a custom subject template that renders more than 200 characters
      When the email subject is rendered
      Then the subject is clipped to 200 characters with a trailing ellipsis

  Rule: One template handles both immediate and digest dispatch

    Scenario: A template iterating matches renders one entry for an immediate dispatch
      Given a custom template that iterates over the matches collection
      And the dispatch carries a single matched trace
      When the notification is rendered
      Then the output contains exactly one match entry

    Scenario: The same template renders every entry for a digest dispatch
      Given a custom template that iterates over the matches collection
      And the dispatch carries several matched traces
      When the notification is rendered
      Then the output contains one entry per matched trace

  Rule: Slack templates declare their type explicitly

    Scenario: A string Slack template is sent as plain text
      Given a Slack template typed as a plain string
      When the Slack notification is rendered
      Then the message is sent as text with no blocks

    Scenario: A Block Kit Slack template is sent as blocks
      Given a Slack template typed as Block Kit that renders valid JSON blocks
      When the Slack notification is rendered
      Then the message is sent as a blocks payload

  Rule: Block Kit output is restricted to a safe allowlist

    Scenario: Disallowed and interactive blocks are stripped
      Given a Block Kit template that renders section, divider, and an interactive actions block
      When the Slack notification is rendered
      Then the section and divider blocks are kept
      And the interactive actions block is removed

  Rule: Template failures fall back to the default and are surfaced

    Scenario: A template that throws falls back to the default
      Given a custom template that raises an error while rendering
      When the notification is rendered
      Then the default notification is rendered instead
      And the render error is reported for operator visibility

    Scenario: Block Kit that is not valid JSON falls back to the default
      Given a Block Kit template whose output is not valid JSON
      When the Slack notification is rendered
      Then the default Slack notification is rendered instead
      And the parse failure is reported for operator visibility

    Scenario: A missing variable renders empty rather than failing
      Given a custom template that references a variable the context does not provide
      When the notification is rendered
      Then the missing variable renders as empty text
      And the dispatch still succeeds
      And the missing variable name is reported for operator visibility

  Rule: A test fire is unmistakably marked

    Scenario: Test-fire email carries a non-suppressible banner
      Given the notification is dispatched as a test fire
      When the email is rendered
      Then the subject is prefixed to mark it as a test
      And the body opens with a notice that it is a test fire

    Scenario: Test-fire Slack carries a non-suppressible banner
      Given the notification is dispatched as a test fire
      When the Slack message is rendered
      Then the message opens with a notice that it is a test fire

  Rule: Templates are validated before they are saved

    Scenario: A syntactically invalid template is rejected
      Given a template with invalid Liquid syntax
      When the template is validated
      Then validation fails with a syntax error message

    Scenario: A syntactically valid template passes validation
      Given a template with valid Liquid syntax
      When the template is validated
      Then validation succeeds
