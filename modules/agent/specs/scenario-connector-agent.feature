@agent
Feature: Scenario Connector agent
  A Scenario Connector is an agent type LangWatch hosts: the user writes only how to reach
  their own API, as a call block and optional setup and teardown blocks. Decided in ADR-194.

  @integration
  Scenario: A connector agent is created through the agent REST API
    Given a call block, a setup block, a teardown block, two secret names and a fixtures dataset
    When a connector agent is created through POST /api/v1/agents
    Then it answers 201 with type "connector" and the config as sent
    And a read of the agent answers the same config

  @unit
  Scenario: A connector agent needs a call block
    Given a connector config with no call block
    When it is parsed
    Then it is refused

  @unit
  Scenario: A connector block is Python and at most 64 KiB
    Given a connector block in another language, or with no code, or with code over 64 KiB
    When the config is parsed
    Then it is refused

  @unit
  Scenario: A connector names its secrets by their project secret names
    Given a connector config whose secret names include one that is not capital letters, digits and underscores
    When it is parsed
    Then it is refused

  @unit
  Scenario: A connector config keeps every field it is saved with
    Given a connector config with setup, call, teardown, secret names, a fixtures dataset and a timeout
    When it is parsed for the connector agent type
    Then every field is kept

  # The editor (ADR-194 phase 2) sits behind the release_scenario_connector_steps flag, which runs
  # check too; off by default.
  Rule: The connector editor

    @integration
    Scenario: The new agent flow offers a Scenario Connector while its flag is on
      Given the project's release_scenario_connector_steps flag is on
      When a user opens the new agent flow
      Then a Scenario Connector card is offered after Code Agent
      And choosing it opens the connector editor

    @integration
    Scenario: The new agent flow hides the Scenario Connector while its flag is off
      Given the project's release_scenario_connector_steps flag is off
      When a user opens the new agent flow
      Then no Scenario Connector card is offered

    @integration
    Scenario: The connector editor says connectors are not enabled while its flag is off
      Given the project's release_scenario_connector_steps flag is off
      When the connector editor is opened by its address
      Then it says Scenario Connector agents are not enabled for this project
      And it offers no form and no save

    @integration
    Scenario: A user writes a connector's blocks, picks its secrets and dataset, and creates it
      Given a project with the secrets SHOP_ADMIN_KEY and OTHER_KEY and a dataset "Orders"
      When a user names a new connector, writes its call block, adds a setup and a teardown block
      And picks SHOP_ADMIN_KEY, the "Orders" dataset and a 30 second timeout
      And creates it
      Then a connector agent is created with that call, setup and teardown code
      And it names only SHOP_ADMIN_KEY, the "Orders" dataset and a timeout of 30000 ms

    @integration
    Scenario: Reopening a connector loads its saved config
      Given a saved connector with setup, call and teardown code, a secret, a dataset and a timeout
      When a user opens it from the Agents page
      Then the editor shows each block's code, the picked secret, the dataset and the timeout
      And saving it unchanged updates the agent with the same config

    @unit
    Scenario: Reopening a connector whose saved config no longer parses keeps its blocks
      Given a saved connector config the schema now refuses, for example one naming 51 secrets
      When its editor form is seeded from it
      Then the form holds its call, setup and teardown code and its picks, not the starter code

    @integration
    Scenario: A connector whose saved config cannot be read shows the error and nothing to save
      Given a saved connector whose read fails
      When a user opens it
      Then the editor shows the failure with "Try again", which reads the connector again
      And it shows no form and no Save, so the stored config cannot be overwritten

    @integration
    Scenario: A connector editor cannot be closed while its save is in flight
      Given a user has saved a connector and the save has not answered
      Then Cancel and the drawer's close button are disabled

    @integration
    Scenario: A connector save that answers after its editor closed closes nothing
      Given a user saved a connector and its editor closed before the save answered
      When the save answers
      Then neither the editor's onSave nor its onClose is called
      And a save that answers while its editor is still open closes it and reports the agent

    @integration
    Scenario: A connector agent's card opens its editor
      Given the Agents page lists a connector agent
      When a user opens or edits its card
      Then the connector editor opens on that agent

    @integration
    Scenario: A connector with no call code is not saved
      Given a new connector whose call block holds only whitespace
      When the user saves it
      Then the call block says it needs code
      And no agent is created

    @integration
    Scenario: A connector naming a secret outside the secret name pattern is not saved
      Given a project secret named "legacy_token"
      When a user picks it for a new connector and saves
      Then the secrets field says a secret name is capital letters, digits and underscores
      And no agent is created
