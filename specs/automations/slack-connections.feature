Feature: Slack connections

  An organization keeps any number of named Slack connections, each a bot
  token or an incoming webhook, each usable by the whole organization or by
  one project. Automations point at a connection instead of carrying their own
  copy of the secret, so a secret is stored once per scope and rotated there.

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
    Scenario: The same secret cannot be stored twice in one scope
      Given the organization already has a connection named "Alerts bot" with a bot token
      When the user adds another connection with the same token in the same scope
      Then it is refused with the machine-readable connection-exists code naming "Alerts bot"

    @unit
    Scenario: A project connection is refused when its organization already holds the secret
      Given the organization has an organization connection named "Alerts bot" with a bot token
      When the user adds a project connection with the same token
      # The project can already use that connection, so a copy adds nothing.
      Then it is refused with the machine-readable connection-exists code naming "Alerts bot"

    @unit
    Scenario: A secret only another project holds can still be stored for this project
      Given another project has a project connection holding a webhook URL
      When the user adds a project connection with the same URL
      Then a project connection for this project holds it
      And the other project's connection is unchanged and still project-scoped

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
    Scenario: Deleting a connection in use is refused and names its automations
      Given a connection the automations "Errors to ops" and "Daily digest" deliver through
      When the user deletes it
      Then it is refused with the machine-readable in-use code naming both automations
      And the drawer says "Used by 2 automations: Errors to ops, Daily digest"
      And the connection is kept

    @integration
    Scenario: A connection deletes once no automation uses it
      Given a connection one automation delivered through
      And that automation now delivers through another connection
      When the user deletes the first connection and confirms
      Then the connection is removed

    @unit
    Scenario: Narrowing an organization connection other projects use is confirmed first
      Given an organization connection that two automations in another project deliver through
      When the user rescopes it to this project
      Then it is refused with the machine-readable in-use code carrying the count of two
      And the connection keeps its organization scope
      When the user confirms
      Then the connection is scoped to this project

    @integration
    Scenario: Deleting an unused connection is confirmed too
      Given a connection no automation delivers through
      When the user deletes it
      Then the drawer asks to confirm that nothing uses it and its saved secret is removed
      And nothing is deleted yet
      When the user confirms
      Then the connection is removed

  Rule: Saving never widens a connection's scope

    A save only ever writes the scope the caller asked for. Legacy secrets from
    the API, MCP, CLI or an automation save reuse a connection this project can
    already use, or become a new project connection. Only an explicit
    organization-scoped create or move makes an organization connection.

    @unit
    Scenario: A legacy secret held only by another project creates a connection for this project
      Given another project has a project connection holding a webhook URL
      When an automation in this project is saved with that webhook URL as a legacy secret
      Then a new project connection for this project holds it and the automation points at it
      And the other project's connection is unchanged and still project-scoped

    @unit
    Scenario: A legacy secret this project can already use reuses that connection
      Given the organization has an organization connection holding a bot token
      When an automation in this project is saved with that bot token as a legacy secret
      Then the automation points at the organization connection
      And no connection is created or changed

    @unit
    Scenario: Two saves of one legacy secret racing in one project share one connection
      Given two automations in this project are saved with the same new webhook URL at once
      When one save's insert is refused by the unique secret index
      Then that save points at the connection the other stored
      And no connection's scope is changed

    @unit
    Scenario: Only an explicit organization-scoped create makes an organization connection
      Given two projects that each saved the same webhook URL as a legacy secret
      Then each holds its own project connection and none is organization-scoped
      When a user who can manage the organization adds a connection with that URL scoped to the organization
      Then an organization connection holds it
      And both project connections are left as they were

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

  Rule: An automation claims the connection it delivers through

    @integration
    Scenario: Saving an automation on a connection claims it
      Given a connection no automation delivers through
      When the user saves an automation that delivers through it
      Then the connection is used by that automation

    @integration
    Scenario: Moving an automation to another connection releases the first
      Given an automation that delivers through connection A
      When the user changes it to deliver through connection B
      Then connection B is used by the automation
      And connection A is no longer used by it

    @integration
    Scenario: Pausing or deleting an automation releases its connection
      Given two automations that deliver through one connection
      When the user pauses one and deletes the other
      Then no automation uses the connection

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
      Then a connection for that URL this project can already use is reused, or a project connection is created
      And no connection's scope is changed
      And the automation points at it and stores no secret of its own

  Rule: No save writes a Slack secret onto an automation

    An automation not yet migrated still holds its own secret. Saving it moves
    that secret into a connection rather than writing it back, so the only
    rows that ever carry one are rows nobody has saved since.

    @integration
    Scenario: Saving an automation not yet migrated from the dashboard moves its token into a connection
      Given an automation with no connection that still stores its own bot token
      When the user saves it from the dashboard without retyping the token
      Then it points at a connection of this project holding that token
      And it stores no token of its own
      And it still delivers with that token

    @integration
    Scenario: Writing back what the API read moves a legacy webhook URL into a connection
      Given an automation with no connection that still stores its own webhook URL
      When the integrator reads it over the API and writes the response back unchanged
      Then it points at a connection of this project holding that URL
      And it stores no URL of its own
      And it still delivers to that URL

    @unit
    Scenario: A save with no connection stores no secret
      Given a Slack save that names no connection
      When its delivery configuration is prepared for storage
      Then no bot token, webhook URL or token-set flag is kept

  Rule: A read returns a Slack automation's connection, never a secret

    @unit
    Scenario: Reading an automation returns only its connection, method and channel
      Given an automation not yet migrated that stores its own bot token and webhook URL
      When it is read by the dashboard or the API
      Then its Slack settings carry only the connection id, delivery method and channel
      And no token, webhook URL, ciphertext or token-set flag appears
      And the rule a graph alert or report fires by is returned as stored

  Rule: One system migration moves every automation's secret into connections and claims them

    @integration
    Scenario: Automations sharing a secret share one connection
      Given three automations in one project with the same bot token
      And two automations in that project with the same webhook URL
      When the Slack connection migration runs for the organization
      Then two project connections exist
      And each automation points at the connection holding its secret

    @integration
    Scenario: A secret shared across projects becomes one connection per project
      Given automations in two projects with the same webhook URL
      When the Slack connection migration runs for the organization
      Then each project has its own project connection holding that URL
      And no organization connection is created
      And each automation points at its own project's connection

    @integration
    Scenario: A project's existing connection absorbs matching automations
      Given a project whose Slack integration was set up before this change
      And an automation in it with the same token
      And a bot automation in it with no token of its own
      When the Slack connection migration runs for the organization
      Then both automations point at the existing connection
      And no second connection was created

    @integration
    Scenario: A pass that moved anything runs again, and a pass with nothing left finishes
      Given automations in an organization that still store their own secrets
      When the Slack connection migration runs for the organization
      Then the organization is reported migrated, not finished
      When it runs again
      Then it creates and links nothing and the organization is reported finished

    @integration
    Scenario: A secret that cannot be decrypted is skipped, not guessed
      Given an automation whose stored token cannot be decrypted
      When the Slack connection migration runs for the organization
      Then that automation is reported as skipped and left unchanged

    @integration
    Scenario: Another project's connection is never widened or borrowed
      Given a project whose Slack integration was set up before this change
      And an automation in another project with the same token
      When the Slack connection migration runs for the organization
      Then that connection keeps its project scope
      And the other project's automation points at a new connection of its own project

    @integration
    Scenario: The migration clears the secret each automation stored
      Given automations that still store their own bot token or webhook URL
      And an automation an earlier run pointed at a connection that still stores its own token
      When the Slack connection migration runs for the organization
      Then every one of them points at a connection
      And none stores a bot token, webhook URL or token-set flag
      When it runs again
      Then nothing changes

    @integration
    Scenario: An organization connection holding the secret is reused as it is
      Given an organization connection holding a webhook URL
      And automations in two projects with that URL
      When the Slack connection migration runs for the organization
      Then both automations point at that connection
      And the connection is unchanged and no other is created

    @integration
    Scenario: Automations the migration must not touch are left unchanged
      Given a deleted automation, an automation in an archived project and an automation already pointing at a connection with no secret of its own
      When the Slack connection migration runs for the organization
      Then none of them changes
      And no connection is created for them

    @unit
    Scenario: The migration runs by itself, on cloud and self-hosted
      Then automation registers the Slack connection migration as "automations-slack-connections"
      And every organization is enrolled without an operator's confirmation, on cloud and on self-hosted
      And there is no manual Slack connection migration task

    @unit
    Scenario: The migration report never prints a secret
      Given automations whose tokens and webhook URLs the migration creates, reuses or skips
      When the Slack connection migration reports an organization's pass
      Then each new connection is named by the last four characters of its secret
      And no token, webhook URL or stored ciphertext appears anywhere in the report

    @integration
    Scenario: A concurrent run that stored the secret first is reused, not duplicated
      Given another run stores a connection for a secret after this run planned to create one
      When this run writes its plan and the unique secret index refuses the insert
      Then it re-plans and links its automations to the stored connection
      And no second connection holds that secret

    @integration
    Scenario: An automation edited while the migration runs is left as edited
      Given an automation edited after the migration planned it
      When the migration links automations
      Then that automation keeps the edit, is not linked and is reported as changed during migration

    @integration
    Scenario: One organization's failure does not stop the others
      Given two organizations with Slack automations to migrate
      And writing the first organization's connections fails partway
      When the Slack connection migration runs for the organization
      Then the first organization keeps no connection and no link
      And the second organization is migrated
      And the first organization's pass fails by its error code, never its message, and is retried on a later pass

    @unit
    Scenario: A pass aborted at shutdown writes nothing
      Given the Slack connection migration has planned an organization
      When the pass is aborted before it writes
      Then no connection, link or claim is written

    @integration
    Scenario: The migration claims the connection of every Slack automation
      Given automations that delivered through connections before claims existed
      When the Slack connection migration runs for the organization
      Then each connection is used by the automations that deliver through it
      And running it again changes nothing
