Feature: Slack delivery

  How an automation reaches Slack, and what happens to the credential it
  reaches it with.

  There are two surfaces. An incoming webhook renders only a subset of Block
  Kit, so the newer blocks — charts, tables, alert banners — degrade to their
  fallback. The Web API (chat.postMessage), reached with a bot token, renders
  them. New automations use the Web API; webhooks stay editable so the
  automations that already have one keep working.

  Since ADR-093 §5 the bot token belongs to the project, not to the automation:
  it is configured once in the project's integration settings and the composer
  only ever asks for a channel. An automation saved before that keeps its own
  encrypted token until someone explicitly switches it over, and the token is
  never returned to a browser in either form. The resolution order, the
  migration affordances and the failure code live in source-merge.feature's two
  Slack rules; this file covers the delivery surface itself.

  These scenarios lived in platform/app/specs/monitors/slack-bot-delivery.feature
  until ADR-093 §5. That second specs root is not scanned by the feature-parity
  check, so every scenario in it was inert — the file read as coverage and
  enforced nothing. Moving them here is what makes them real.

  See dev/docs/adr/041-slack-bot-delivery.md, dev/docs/adr/093-automations-source-merge.md.

  Background:
    Given a user in a project

  Rule: The delivery surface follows the connection

    @unit
    Scenario: An automation delivers through an incoming webhook
      Given a Slack automation configured with a webhook URL
      When it fires
      Then the message is posted to the webhook
      And any chart, table, or alert block is dropped and the message degrades to its fallback

    @unit
    Scenario: An automation delivers through a Slack bot connection
      Given a Slack automation configured with a bot token and a channel
      When it fires
      Then the message is posted via the Slack Web API to that channel
      And chart, table, and alert blocks are delivered and render

    @unit
    Scenario: The richer templates are offered only for a bot connection
      Given the template picker
      When the automation uses a webhook
      Then templates whose hero block only renders over the Web API are not selectable
      And a note explains they need a Slack app connection
      When the automation uses a bot connection
      Then those templates become selectable

  Rule: A Slack bot token never leaves the server

    Encryption is the same AES-256-GCM helper the rest of the platform uses.
    What matters to a customer is the consequence: the token they paste is not
    readable afterwards, by them or by anyone reading the row. The composer no
    longer asks for a token (ADR-093 §5), so only legacy automations saved
    before the project integration carry one — and they keep these guarantees
    for as long as they exist.

    @unit
    Scenario: The bot token is protected at rest
      Given a legacy Slack automation saved with its own bot token
      Then the token is stored encrypted, never in plaintext
      And reading the automation back never returns the token to the browser

    @unit
    Scenario: Editing a bot automation without re-entering the token
      Given a saved legacy Slack automation with its own bot token
      When the author edits it and leaves the token blank
      Then the existing token is kept

  Rule: The composer asks only for what the author owns

    The token is the project's, so the only thing left for the author to fill
    in is where the message goes.

    @integration
    Scenario: A bot automation is incomplete without a channel
      Given a new Slack automation set to the bot connection
      When the channel is missing
      Then it cannot be saved

    @integration
    Scenario: The author is guided to connect Slack for the project
      Given the bot connection form in a project with no Slack integration
      Then it points at the project's integration settings, where creating a Slack app and granting its scopes is explained
