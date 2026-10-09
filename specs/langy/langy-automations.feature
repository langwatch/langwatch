Feature: Langy sets up automations and delivers them to Slack, email and webhooks
  As a LangWatch user chatting with Langy
  I want Langy to create, pause and resume automations for me
  So that an alert on my agent reaches the people who need it, without my opening the Automations page

  # Langy works through the `langwatch trigger` CLI commands, which call the
  # public automations API. A Slack delivery goes through a Slack connection the
  # project can already use: Langy never takes a bot token, a webhook URL or a
  # signing secret in chat, never creates a connection itself, and never echoes a
  # stored secret. The public API has no read that lists Slack connections, so
  # the panel lists them for the viewer, with the viewer's own session.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: An automation Langy touched renders as an automation card

    @integration
    Scenario: A created alert renders as an automation card
      When Langy creates an alert that fires when a graph's error rate goes over 5% in 5 minutes
      Then Langy shows an automation card named after the alert
      And the card says it is an alert and states its condition
      And the card shows the alert as active
      And the card offers an "Open in Automations" link to that automation

    @integration
    Scenario: A Slack destination names its connection and channel
      Given the project can use a Slack connection named "Support Slack"
      When Langy creates an automation that posts through "Support Slack" to #support-alerts
      Then the automation card shows a Slack destination naming "Support Slack" and #support-alerts

    @integration
    Scenario: An email automation lists its recipients as the destination
      When Langy creates an automation that emails me when a trace gets a thumbs-down
      Then the automation card shows an email destination with my address
      And the card states the trace condition it watches

    @integration
    Scenario: Pausing an automation shows it paused
      Given Langy created an alert in this conversation
      When Langy pauses that alert
      Then the automation card shows the alert as paused

    @integration
    Scenario: A list of automations renders one row per automation with its state
      When Langy lists the project's automations
      Then Langy shows one row per automation with its destination and whether it is active or paused

    @unit
    Scenario: The automation card never shows a stored secret
      Given an automation that delivers to a webhook whose address carries a token in its query string
      When the automation card summarises its destination
      Then the destination shows the webhook's host only
      And no bot token, webhook URL or signing secret appears on the card

  Rule: A Slack delivery goes through a connection the project can already use

    @integration
    Scenario: No Slack connection yet guides me to add one
      Given the project can use no Slack connection
      When Langy's Slack automation is refused for want of a connection
      Then Langy shows a Slack connection card saying the project has no Slack connection yet
      And the card offers "Add a Slack connection", which opens the Slack connection drawer in Automations
      And Langy creates no Slack connection itself

    @integration
    Scenario: Existing Slack connections are offered to pick from
      Given the project can use a Slack connection named "Support Slack"
      When Langy's Slack automation is refused for want of a connection
      Then the Slack connection card lists "Support Slack" with its kind and scope
      And choosing "Use this connection" answers Langy with that connection's name and id, and no secret

    @integration
    Scenario: A refused create shows the API's reason
      When Langy's Slack automation is refused by the automations API
      Then the Slack connection card shows the reason the API gave

    @unit
    Scenario: The prompt routes alert and Slack requests to the automations skill
      When the Langy prompt is read
      Then alert, automation and Slack delivery requests route to the automations skill

    @unit
    Scenario: The automations skill never asks for a Slack secret
      When the automations skill is read
      Then it tells Langy never to take a bot token, webhook URL or signing secret in chat
      And it tells Langy to use an existing Slack connection, or to send the user to add one
