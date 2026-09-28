Feature: Slack connections

  An organization keeps any number of named Slack connections, each a bot
  token or an incoming webhook, each usable by the whole organization or by
  one project. Automations point at a connection instead of carrying their own
  copy of the secret, so a secret is stored once and rotated in one place.

  Supersedes the "Slack is set up once per project" and "An automation's own
  stored token outranks the project integration" rules that lived in
  source-merge.feature. See dev/docs/adr/093-automations-source-merge.md §5a.

  Background:
    Given a user in a project of an organization

  Rule: Connections are named, many, and scoped per connection

    @integration
    Scenario: Adding a bot connection for the organization
      Given the user can manage the organization
      When the user adds a Slack connection named "Alerts bot" with a valid bot token scoped to the organization
      Then the connection is listed with its name, the workspace Slack reported and an organization badge
      And every project in the organization can use it
      And the token itself is never returned to the client

    @integration
    Scenario: Adding a webhook connection for one project
      Given the user can manage the project
      When the user adds a Slack connection with an incoming webhook URL scoped to the project
      Then it is listed with a project badge and only the last four characters of the URL
      And other projects in the organization cannot use it

    @integration
    Scenario: A project lists its own connections and its organization's
      Given the organization has one organization connection
      And the project has one project connection
      And another project has one project connection
      When the user lists the Slack connections the project can use
      Then the organization connection and the project connection are listed
      And the other project's connection is not

    @integration
    Scenario: A token Slack rejects is refused at setup
      When the user adds a bot connection with a token the workspace rejects
      Then it is refused with the machine-readable invalid-token code
      And no connection is stored

    @integration
    Scenario: The same secret cannot be stored twice in an organization
      Given the organization already has a connection named "Alerts bot" with a bot token
      When the user adds another connection with the same token
      Then it is refused with the machine-readable connection-exists code naming "Alerts bot"

    @integration
    Scenario: Scope decides who may change a connection
      Given the user can manage the project but not the organization
      Then the user can add, edit and delete project connections
      And the user cannot add, edit or delete organization connections
      And organization connections are still listed and usable

    @integration
    Scenario: Replacing a secret needs no automation edits
      Given a bot connection that several automations deliver through
      When the user pastes a new token for it and saves
      Then subsequent deliveries use the new token
      And no automation was edited

    @integration
    Scenario: Editing a connection without retyping its secret keeps the secret
      Given a saved connection
      When the user renames it and leaves the secret field untouched
      Then the stored secret is kept

    @integration
    Scenario: Deleting a connection in use says what stops delivering
      Given a connection three active automations deliver through
      When the user deletes it
      Then it is refused with the machine-readable in-use code carrying the count of three
      And the drawer asks to confirm that three automations stop delivering
      When the user confirms
      Then the connection is removed

  Rule: The settings page and the automation drawer share one connection drawer

    @integration
    Scenario: Settings lists connections and opens the drawer
      When the user opens the integrations settings
      Then the Slack section lists every connection the project can use, with how many automations use each
      And "Add Slack connection" opens the Slack connection drawer

    @integration
    Scenario: A connection created from the automation drawer is selected on return
      Given the user is configuring Slack delivery in the automation drawer
      When the user chooses "New Slack connection" and saves a connection in the drawer that opens
      Then the automation drawer is back with the draft intact
      And the new connection is selected

    @integration
    Scenario: Walking away from a new connection keeps the previous choice
      Given the automation's Slack delivery has a connection selected
      When the user opens "New Slack connection" and closes it without saving
      Then the previous connection is still selected

    @integration
    Scenario: A bot connection asks for a channel, a webhook does not
      Given the user is configuring Slack delivery
      When the user picks a bot connection
      Then a channel is required, listed from that connection's workspace
      When the user picks a webhook connection
      Then no channel is asked for

  Rule: Delivery resolves through the automation's connection

    @unit
    Scenario: An automation delivers through its connection
      Given an automation pointing at a bot connection and a channel
      When it fires
      Then the message is posted with that connection's token to that channel

    @unit
    Scenario: A connection outside the automation's reach fails with a named cause
      Given an automation pointing at a connection that was deleted or belongs to another project
      When it fires
      Then the delivery fails with the machine-readable integration-missing code

    @unit
    Scenario: An automation not yet migrated keeps delivering with its own secret
      Given an automation with no connection that still stores its own bot token or webhook URL
      When it fires
      Then the delivery uses its own secret

    @integration
    Scenario: The API accepts a connection id
      When an API client creates a Slack automation with a connection id and a channel
      Then the automation is created pointing at that connection
      And reading it back returns the connection id and no secret

    @integration
    Scenario: A legacy secret over the API is stored as a connection
      When an API client creates a Slack automation with a webhook URL
      Then a project connection for that URL is found or created
      And the automation points at it and stores no secret of its own

  Rule: One migration moves every automation's secret into connections

    @integration
    Scenario: Automations sharing a secret share one connection
      Given three automations in one project with the same bot token
      And two automations in that project with the same webhook URL
      When the Slack connection migration runs with apply
      Then two project connections exist
      And each automation points at the connection holding its secret

    @integration
    Scenario: A secret shared across projects becomes an organization connection
      Given automations in two projects with the same webhook URL
      When the Slack connection migration runs with apply
      Then one organization connection holds that URL
      And both automations point at it

    @integration
    Scenario: A project's existing connection absorbs matching automations
      Given a project whose Slack integration was set up before this change
      And an automation in it with the same token
      And a bot automation in it with no token of its own
      When the Slack connection migration runs with apply
      Then both automations point at the existing connection
      And no second connection was created

    @integration
    Scenario: The migration changes nothing unless applied, and nothing twice
      When the Slack connection migration runs without apply
      Then it reports what it would create and link, and writes nothing
      When it runs with apply twice
      Then the second run creates and links nothing

    @integration
    Scenario: A secret that cannot be decrypted is skipped, not guessed
      Given an automation whose stored token cannot be decrypted
      When the Slack connection migration runs with apply
      Then that automation is reported as skipped and left unchanged
