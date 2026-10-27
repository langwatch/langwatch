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

  # --- Protection ---

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

  @unit
  Scenario: The backfill dry run writes nothing
    Given an agent without versions
    When the backfill step runs as a dry run
    Then no version is written and no checkpoint is saved

  # --- UI ---

  @integration
  Scenario: The history drawer shows versions and opens the deploy dialog
    Given an agent with versions 1 and 2 and "production" on version 1
    When the user opens the agent's history
    Then the versions are listed newest first with author, date and labels
    And "Deploy" opens a dialog with latest, production and staging rows
    And saving the dialog assigns the chosen versions

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
