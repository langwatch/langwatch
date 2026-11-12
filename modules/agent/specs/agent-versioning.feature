Feature: Agent versions and deploy labels
  As a LangWatch user
  I want every change to an agent kept as a numbered version, and labels like
  production and staging pointing at the version each environment runs
  So that I can change an agent without changing what production calls, and see who changed it

  The agent row stays the latest version, so every reader that names no label or
  version keeps reading what it read before. Labels follow the prompt tag rules:
  production and staging are offered by default, a label is lowercase, starts with
  a letter, is not a number, and "latest" is virtual and never stored.
  Connected agents are versioned by the code that registers them, so they carry no versions here.

  # --- Versions ---

  @unit
  Scenario: Creating an agent records version 1
    Given a project with no agents
    When a user creates an HTTP agent "Support bot"
    Then the agent has version 1 authored by that user
    And the agent records that user as its creator and last updater

  @unit
  Scenario: Every update appends a version and keeps the head as latest
    Given an agent "Support bot" at version 1
    When a user updates its config with the commit message "Use the new endpoint"
    Then the agent has versions 1 and 2, newest first
    And version 2 carries the new config, the commit message and the user as author
    And version 1 still carries the old config
    And reading the agent with no label or version returns the version 2 config

  @integration
  Scenario: A system config write appends a version too
    Given an agent bound to a workflow at version 1
    When the workflow sync rewrites its config
    And the credential move rewrites it while the row is unchanged
    Then the agent has versions 1, 2 and 3, each with the config written
    And a credential move against a row that changed since it read is refused

  @integration @unit
  Scenario: A write that changes nothing appends no version
    Given an agent bound to a workflow at version 1
    When a user saves the same name and config
    And the workflow sync rewrites the same config
    Then the agent still has only version 1

  @unit
  Scenario: An update by an API key records the key as the author kind
    Given an agent "Support bot" at version 1
    When an API key updates its name
    Then version 2 names no user and has the author kind "api_key"
    And the agent keeps its creator and names no last updating user

  @unit
  Scenario: Connected agents are not versioned
    Given a connected agent registered by the SDK
    When its versions are listed
    Then the list is empty
    And assigning a label to it is refused with code "agent_version_unsupported"

  # --- Labels ---

  @unit
  Scenario: Deploying a label points it at a version
    Given an agent with versions 1, 2 and 3
    When a user with "agents:deploy" assigns "production" to version 2
    Then reading the agent with label "production" returns the version 2 config and version number 2
    And reading the agent with version 3 returns the version 3 config
    And the versions list shows "production" on version 2

  @unit
  Scenario: Moving a label repoints it
    Given an agent whose "production" label points at version 2
    When a user assigns "production" to version 3
    Then reading the agent with label "production" returns version 3
    And the label records the user who moved it

  @unit
  Scenario: Removing a label falls back to nothing, not to latest
    Given an agent whose "staging" label points at version 2
    When a user removes the "staging" label
    Then reading the agent with label "staging" is refused with code "agent_version_not_found"

  @unit
  Scenario Outline: Label names follow the prompt tag rules
    Given an agent with versions 1 and 2
    When a user assigns the label "<label>" to version 1
    Then it is refused with code "agent_label_invalid"

    Examples:
      | label      |
      | latest     |
      | 42         |
      | Production |
      | -canary    |

  @unit
  Scenario: A label cannot point at a version of another agent
    Given two agents in the project
    When a user assigns "production" on the first agent to a version that does not exist on it
    Then it is refused with code "agent_version_not_found"

  @unit
  Scenario: Asking for a label and a version at once is refused
    When a caller reads an agent with both a label and a version
    Then it is refused with code "agent_version_selector_conflict"

  @unit
  Scenario: The id shorthand picks a label or a version
    Given an agent "agent_1" whose "production" label points at version 2
    When a caller reads "agent_1:production"
    Then version 2 is returned
    When a caller reads "agent_1:3"
    Then version 3 is returned
    When a caller reads "agent_1:latest"
    Then the latest version is returned
    When a caller reads "agent_1" with the label "latest"
    Then the latest version is returned

  # --- Protection ---

  @unit
  Scenario: An unattributed credential cannot bypass the deploy check
    Given a request whose only actor is an internal proof actor, such as an ownerless project key
    When its caller is resolved for a version write or a delete
    Then it is unattributed and holds no deploy permission
    And a named system actor still runs without the check

  @integration
  Scenario: Moving a label needs the deploy permission
    Given a user whose custom role holds "evaluations:manage" but not "agents:deploy"
    When they assign "production" through the tRPC procedure or the REST route
    Then the request is refused before the handler runs with code "permission_denied"

  @unit
  Scenario: Archiving a labelled agent needs the deploy permission
    Given an agent whose "production" label points at version 2
    And a caller without "agents:deploy"
    When the caller archives the agent
    Then it is refused with code "agent_deployed_label_protected" naming the label
    And the agent is not archived

  @integration
  Scenario: The deprecated agents REST alias names its caller like the v1 routes
    Given a caller without "agents:deploy"
    When they create an agent through "/api/agents"
    Then they are recorded as its creator
    When they archive an agent a label points at through "/api/agents"
    Then it is refused with code "agent_deployed_label_protected" and the agent stays

  @unit
  Scenario: Archiving a labelled agent with no caller is refused
    Given an agent whose "production" label points at version 2
    When an archive names no caller
    Then it is refused with code "agent_deployed_label_protected"
    And a named system caller still archives it

  @unit
  Scenario: Archiving an unlabelled agent needs no deploy permission
    Given an agent with no labels
    And a caller without "agents:deploy"
    When the caller archives the agent
    Then the agent is archived

  @unit
  Scenario: A caller with the deploy permission archives a labelled agent
    Given an agent whose "production" label points at version 2
    And a caller holding "agents:deploy"
    When the caller archives the agent
    Then the agent is archived

  # --- Readers ---

  @integration
  Scenario: REST reads an agent by label or version
    Given an agent whose "production" label points at version 1 and whose latest is version 2
    When a client calls GET /api/v1/agents/:id?label=production
    Then the response carries the version 1 config and "version": 1
    When a client calls GET /api/v1/agents/:id
    Then the response carries the version 2 config and "version": 2
    When a client calls GET /api/v1/agents/:id/versions
    Then the response lists both versions with their labels

  @unit
  Scenario: The TypeScript SDK reads an agent at a label and moves its labels
    Given the SDK's agents service
    When it gets an agent with { label: "production" } or { version: 2 }
    Then it calls GET /api/v1/agents/id with that label or version in the query
    And listVersions, assignLabel and removeLabel call the versions and labels routes

  @unit
  Scenario: The Python SDK reads an agent at a label and moves its labels
    Given the Python SDK's agents client
    When it gets an agent with label="production" or version=2
    Then the request carries that label or version as a query parameter
    And list_versions, assign_label and remove_label call the versions and labels routes

  @unit
  Scenario: The CLI lists an agent's versions and deploys a label
    When a user runs "langwatch agent versions <id>"
    Then the versions are printed newest first with their labels
    When a user runs "langwatch agent deploy <id> production --version 2"
    Then production points at version 2
    And without --version the label points at the latest version
    When a user runs "langwatch agent undeploy <id> production"
    Then the label is removed

  @unit
  Scenario: An experiment agent target pinned to a label runs that version
    Given an experiment target naming an agent and the label "production"
    When the experiment loads its targets
    Then the agent is loaded at its production version
    And a target naming no label loads the latest agent

  # --- Backfill ---

  @unit
  Scenario: Existing agents get version 1 from their current config
    Given agents created before versions existed
    When the background step "agent:backfill-versions" runs
    Then each agent has version 1 holding its current config
    And its creator is read from its earliest "agents.create" audit entry
    And a second run writes nothing

  @integration
  Scenario: A legacy agent's first save keeps its old config as version 1
    Given an agent created before versions existed
    When it is saved before the backfill reaches it
    Then version 1 holds the config it had before the save
    And version 2 holds the saved config

  @integration
  Scenario: No version copies a typed-in HTTP credential
    Given an HTTP agent whose config still holds a typed-in credential
    When the backfill runs, the credential move saves the agent or any save writes it
    Then no version holds the typed-in credential
    And archived agents get no version 1

  @integration
  Scenario: A save that keeps losing the version number race is reported as that race
    Given an agent whose every save loses the race for the next version number
    When the agent is saved
    Then the save is tried three times
    And it fails with the version number race, never as a duplicate agent

  @unit
  Scenario: A version listing never carries an HTTP credential
    Given HTTP agent versions whose configs hold header values and an auth token
    When the versions are listed
    Then every literal credential value is blank and secret references are kept
    And a version config that no longer parses is served without its headers and auth

  @unit
  Scenario: The backfill dry run writes nothing
    Given an agent without versions
    When the backfill step runs as a dry run
    Then no version is written and no checkpoint is saved

  # --- Fresh reads after a write ---

  @unit
  Scenario: Every write to an agent records that it changed
    Given an HTTP agent "Support bot" calling "https://old.example.test/chat"
    When a user changes its URL to "https://new.example.test/chat"
    Then an "agent changed" fact is recorded for that agent in its own project
    And creating, copying, pushing to copies, syncing a copy and moving a label record one too
    And a workflow's new fields written into its linked agents record one for each agent
    And a push records one only for the copies it wrote
    And a copy, push or sync also records one for the source agent, so its copies list refetches

  @unit
  Scenario: Two writes to an agent in the same millisecond stay two changed facts
    Given an HTTP agent "Support bot"
    When two writes to it land in the same millisecond
    Then each records its own "agent changed" fact
    And a redelivery of one of them is still that one fact

  @unit
  Scenario: A committed agent write still succeeds when its changed fact cannot be recorded
    Given an HTTP agent "Support bot"
    And the "agent changed" fact cannot be sent
    When a user changes its URL
    Then the change is saved and returned
    And the failure is logged instead of failing the save

  @unit
  Scenario: Every read of an agent goes stale when the agent changes or is archived
    Given the agents list, one agent, its copies, its history and its versions are read
    When an "agent changed" or "agent archived" fact is committed
    Then each of those reads is hinted stale and refetches in every open tab

  @integration
  Scenario: A saved URL change shows at once in the tab that saved it
    Given an HTTP agent calling "https://old.example.test/chat" that the editor has read
    When the user saves it with the URL "https://new.example.test/chat"
    Then the agent, the agents list and its versions are read again
    And the editor, opened again, shows "https://new.example.test/chat" without a reload

  # --- UI ---

  @integration
  Scenario: The history drawer shows versions and opens the deploy dialog
    Given an agent with versions 1 and 2 and "production" on version 1
    When the user opens the agent's history
    Then the versions are listed newest first with author, date and labels
    And "Deploy" opens a dialog with latest, production and staging rows
    And saving the dialog assigns the chosen versions

  @integration
  Scenario: A failed label save shows the registered error and reads the labels again
    Given the deploy dialog is open for an agent
    When saving a label is refused by the server
    Then the dialog stays open and shows the error's registered copy, never its code
    And the agent's labels are read again so a retry starts from what was saved

  @integration
  Scenario: The history drawer says when its versions fail to load
    Given an agent whose versions cannot be read
    When the user opens the agent's history
    Then the drawer says the versions failed to load
    And no Deploy action is offered

  @integration
  Scenario: The deploy dialog adds a custom label and refuses a reserved one
    Given the deploy dialog is open for an agent with versions 1 and 2
    When the user adds a label named "latest" or a number
    Then the dialog explains why the name is refused and the label cannot be added
    And Escape closes the label input but leaves the dialog open
    When the user adds "canary", points it at version 1 and saves
    Then "canary" is assigned to version 1

  @integration
  Scenario: The agent card shows who created it and its version
    Given an agent created by "Ada"
    When the agents screen lists it
    Then its card shows "Created by Ada" and its latest version badge

  @integration
  Scenario: The experiment agent target drawer picks the deploy label
    Given an agent target in the workbench whose agent has "production" on version 2 and latest version 3
    When the user opens the target's agent drawer
    Then the deploy label picker shows "latest" by default
    And picking "production" pins the target to "production"

  @integration
  Scenario: A target pinned to a label opens its agent drawer on that label
    Given an agent target in the workbench pinned to "production"
    When the user clicks the target's column header
    Then the agent drawer's deploy label picker shows "production", not "latest"
    And the label comes from the drawer address, so a reload of that address shows it too
    And after a reload the picker still writes to the target, and a change replaces the address
