Feature: Slack delivery via a bot connection (Web API)
  As a team wiring Slack notifications
  I want to deliver via a Slack app (bot token), not only an incoming webhook
  So that the richer Block Kit blocks (charts, tables, alerts) actually render

  # Acquisition note (ADR-063): manual bot-token entry is superseded by the
  # Slack app install flow (specs/automations/slack-app-install.feature);
  # existing tokens fold into the managed integration. Delivery semantics
  # below are unchanged.

  Background:
    Given the incoming-webhook surface renders only a subset of Block Kit
    And the Web API (chat.postMessage) surface renders the newer blocks

  Scenario: An automation delivers through an incoming webhook
    Given a Slack automation configured with a webhook URL
    When it fires
    Then the message is posted to the webhook
    And any chart, table, or alert block is dropped and the message degrades to its fallback

  Scenario: An automation delivers through a Slack bot connection
    Given a Slack automation configured with a bot token and a channel
    When it fires
    Then the message is posted via the Slack Web API to that channel
    And chart, table, and alert blocks are delivered and render

  Scenario: The bot token is protected at rest
    Given a Slack automation is saved with a bot token
    Then the token is stored encrypted, never in plaintext
    And reading the automation back never returns the token to the browser

  Scenario: Editing a bot automation without re-entering the token
    Given a saved Slack automation with a bot token
    When the author edits it and leaves the token blank
    Then the existing token is kept

  Scenario: A bot automation is incomplete without a token and channel
    Given a new Slack automation set to the bot connection
    When the token or channel is missing
    Then it cannot be saved

  Scenario: The richer templates are offered only for a bot connection
    Given the template picker
    When the automation uses a webhook
    Then templates whose hero block only renders over the Web API are not selectable
    And a note explains they need a Slack app connection
    When the automation uses a bot connection
    Then those templates become selectable

  Scenario: The author is guided to create a Slack app
    Given the bot connection form
    Then it links to where to create a Slack app and which scope to grant
