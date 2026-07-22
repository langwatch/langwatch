Feature: Slack app install for automations delivery

  Installing the LangWatch Slack app connects an organization's workspace
  once, so rules deliver by picking a channel instead of pasting webhook
  addresses or tokens. Incoming webhooks keep working; the app is the
  easier path, not a forced migration. The workspace credential is held by
  the platform and can never be read back.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.

  Background:
    Given an organization admin in integration settings

  Rule: Installing connects the workspace once

    Scenario: Installing the Slack app
      When the admin installs the Slack app and authorizes it in their workspace
      Then settings show the connected workspace by name
      And projects in the organization can deliver rules to its channels

    Scenario: A failed authorization leaves nothing connected
      When the admin abandons or fails the Slack authorization
      Then no workspace is connected
      And settings explain that the install did not complete

    Scenario: The workspace credential is write-only
      Given a connected workspace
      Then no surface returns the workspace credential
      And settings show only the workspace identity and granted permissions

  Rule: Rules deliver by channel

    Scenario: Configuring delivery by picking a channel
      Given a connected workspace
      When a user configures a rule's Slack delivery
      Then they pick from the workspace's channels by name
      And the rule delivers to the picked channel

    Scenario: Incoming webhooks remain supported
      Given no connected workspace
      When a user configures a rule's Slack delivery
      Then delivery by incoming webhook is available as before

    Scenario: A previously pasted token folds into the integration
      Given the organization previously used a manually provided workspace token
      Then existing rules keep delivering
      And settings offer the app install as the managed replacement

  Rule: Delivery failures explain what to fix

    Scenario: The app is not in the channel
      Given a rule delivering to a channel the app cannot post to
      When the rule fires
      Then the delivery failure explains how to let the app post there

    Scenario: A revoked install stops deliveries with a clear reason
      Given the workspace authorization was revoked in Slack
      When a rule fires
      Then the delivery failure explains the workspace must be reconnected
      And settings show the integration needs attention

  Rule: Disconnecting is deliberate

    Scenario: Disconnecting the workspace
      Given a connected workspace with rules delivering to its channels
      When the admin disconnects it
      Then they are warned which rules will stop delivering
      And after confirming, those rules report a delivery configuration problem
