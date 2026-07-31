Feature: Slack delivery via a bot connection (Web API)
  As a team wiring Slack notifications
  I want to deliver via a Slack app (bot token), not only an incoming webhook
  So that the richer Block Kit blocks (charts, tables, alerts) actually render

  Background:
    Given the incoming-webhook surface renders only a subset of Block Kit
    And the Web API (chat.postMessage) surface renders the newer blocks

  # Which blocks Slack itself chooses to render on each surface is Slack's
  # behaviour, not ours, so it is stated as context above rather than asserted
  # in a scenario we could never make fail.

  @unit
  Scenario: An automation delivers through an incoming webhook
    Given a Slack automation configured with a webhook URL
    When it fires
    Then the rendered message is posted to the webhook

  @unit
  Scenario: An automation delivers through a Slack bot connection
    Given a Slack automation configured with a bot token and a channel
    When it fires
    Then the message is posted via the Slack Web API to that channel
    And the call carries the bot token as a bearer credential

  @unit
  Scenario: The bot token is protected at rest
    Given a Slack automation is saved with a bot token
    Then the token is stored encrypted, never in plaintext
    And reading the automation back never returns the token to the browser

  @unit
  Scenario: Editing a bot automation without re-entering the token
    Given a saved Slack automation with a bot token
    When the author edits it and leaves the token blank
    Then the existing token is kept

  @unit
  Scenario: A bot automation is incomplete without a token
    Given a new Slack automation set to the bot connection
    When neither a new token nor a stored one is present
    Then it reads as missing its token

  # Nothing asserts the channel half of the same completeness rule.
  @unit @unimplemented
  Scenario: A bot automation is incomplete without a channel
    Given a new Slack automation set to the bot connection
    When no channel is chosen
    Then it cannot be saved

  @unit
  Scenario: Switching to a webhook leaves no bot fields behind
    Given a Slack automation that had a bot connection
    When it is saved in webhook mode
    Then only the webhook is persisted, with no stale bot fields

  @integration
  Scenario: The richer templates are offered only for a bot connection
    Given the template picker
    When the automation uses a webhook
    Then templates whose hero block only renders over the Web API are not selectable
    When the automation uses a bot connection
    Then those templates become selectable

  # No test asserts the help copy or where it points.
  @integration @unimplemented
  Scenario: The author is guided to create a Slack app
    Given the bot connection form
    Then it links to where to create a Slack app and which scope to grant
