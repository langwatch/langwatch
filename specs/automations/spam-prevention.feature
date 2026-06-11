Feature: Trigger email spam prevention

  LangWatch-operated email is an abuse and cost vector: test fires could relay
  mail to arbitrary addresses, immediate-cadence triggers have no volume
  ceiling, and external recipients have no way to opt out. Three protections
  close these, all email-only — Slack posts to the customer's own workspace
  via a webhook they provisioned, so it carries no third-party victim and no
  per-message cost.

  See dev/docs/adr/031-trigger-email-abuse-protections.md.

  Background:
    Given a project with automations enabled

  Rule: Test fires deliver only to the requesting user

    Scenario: A test email goes to the requester's own inbox
      Given a user authoring an email automation
      When they fire a test of the template
      Then the rendered email is delivered to their own account email
      And no other recipient receives it

    Scenario: The authoring drawer shows where the test will land
      Given a user authoring an email automation
      When they open the test-fire affordance
      Then there is no recipients input
      And the drawer states the test will be sent to their own email

    Scenario: Rapid-fire test sends are rate limited
      Given a user who has just sent many tests in quick succession
      When they fire another test
      Then the request is rejected with a rate-limit error
      And the error tells them when they can retry

    Scenario: Slack test fires still go to the configured webhook
      Given a user authoring a Slack automation with a webhook URL
      When they fire a test of the template
      Then the rendered message is posted to that webhook

  Rule: A trigger cannot send unbounded email in an hour

    Scenario: Sends under the hourly cap deliver normally
      Given an immediate-cadence email automation
      When matching traces produce fewer dispatches than the hourly cap
      Then every notification is delivered

    Scenario: Sends past the hourly cap are dropped with a visible error
      Given an immediate-cadence email automation in a trace storm
      When the trigger exceeds its hourly email cap
      Then further emails in that hour are not sent
      And each drop is recorded as an error naming the trigger
      And the dropped dispatches are not retried

    Scenario: The cap resets on the next hour
      Given a trigger that exhausted its cap in the previous hour
      When a matching trace settles in the new hour
      Then its notification is delivered

    Scenario: Digest cadences are unaffected by the cap
      Given an email automation on a 5-minute digest cadence
      When thousands of matching traces arrive in an hour
      Then at most one email per digest window is sent
      And none are dropped by the cap

    Scenario: Slack messages are never capped
      Given an immediate-cadence Slack automation in a trace storm
      When the matching dispatch volume exceeds what the email cap allows
      Then every Slack message is still delivered

  Rule: Every trigger email carries a working unsubscribe

    Scenario: The unsubscribe footer survives custom templates
      Given an email automation with a customer-authored body template
      When a notification is delivered
      Then the email ends with an unsubscribe link the template cannot remove
      And the email carries one-click unsubscribe headers

    Scenario: Unsubscribing from one notification stops only that one
      Given a recipient of two email automations in the same project
      When they unsubscribe choosing "this notification only"
      Then they receive no further email from that automation
      And they still receive email from the other automation

    Scenario: Unsubscribing from the project stops all its notifications
      Given a recipient of two email automations in the same project
      When they unsubscribe choosing "all notifications from this project"
      Then they receive no further email from either automation

    Scenario: The unsubscribe page works without logging in
      Given a recipient who is not a LangWatch user
      When they open the unsubscribe link from a notification
      Then they can complete the unsubscribe without authenticating

    Scenario: An unsubscribe link cannot be forged for someone else
      Given an unsubscribe link whose token has been tampered with
      When it is opened
      Then the request is rejected
      And no suppression is recorded

    Scenario: Suppressed recipients are skipped, others still receive
      Given an email automation with three recipients, one of whom unsubscribed
      When a notification is dispatched
      Then the two remaining recipients receive the email
      And the unsubscribed recipient receives nothing

    Scenario: A dispatch whose recipients are all suppressed sends nothing
      Given an email automation whose every recipient has unsubscribed
      When a matching trace settles
      Then no email is sent
      And the dispatch completes without error
