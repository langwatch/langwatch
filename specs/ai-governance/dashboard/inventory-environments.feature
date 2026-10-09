Feature: The Inventory lists the environments the tools run in
  As an admin mapping where AI runs in the company
  I want the environments my sources already point at, listed
  So that I can see production and staging without typing them in twice

  # ---------------------------------------------------------------------------
  # Nothing in the database is an environment. There is no table, no router, no
  # migration — and the honest options were an empty tab or a fabricated one.
  #
  # There is a third. Two source types are configured by naming an environment:
  # a Copilot Studio source points at a Power Platform environment, and a Genie
  # source points at a Databricks workspace. Both addresses ride on the source's
  # parser configuration, which the router already sends to the client with
  # credentials stripped. So the list is DERIVED from places an admin actually
  # pointed us at, and every row on it is real without a byte being stored.
  #
  # A derived row says where it came from, because that badge is the only thing
  # explaining why a row nobody created is on the screen, and the only place to
  # go to change it.
  #
  # Adding one by hand is offered and is NOT persisted. The dialog says so in
  # its own words, above the button, rather than in a release note. A form that
  # looks like it saves and does not is worse than no form.
  #
  # Implementation:
  #   - platform/app/ee/governance/dashboard/components/environments/
  #
  # Companion specs:
  #   - specs/ai-governance/dashboard/inventory-catalog.feature
  #   - specs/ai-governance/dashboard/governance-ui-controls.feature
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # Discovered environments
  # ===========================================================================

  @integration
  Scenario: An environment a source points at is listed without being created
    Given a source configured against a Power Platform environment
    When the Environments pane renders
    Then that environment is a row in the table
    And the row is badged as discovered from that source
    # The badge is load-bearing: without it the row is an environment the
    # admin never added, from nowhere, that they cannot edit or delete.

  @integration
  Scenario: Two sources pointed at one environment are one row
    Given two sources configured against the same environment address
    When the Environments pane renders
    Then one row is shown for that environment
    # Otherwise the estate doubles on screen every time a second source is
    # pointed at the same place, which is the normal case, not the odd one.

  @integration
  Scenario: A source type that names no environment contributes no row
    Given a source whose configuration names no environment
    When the Environments pane renders
    Then it contributes no row

  @integration
  Scenario: A discovered row says nobody created it
    Given an environment derived from a source
    When its row renders
    Then the created-by column says it was discovered automatically
    # Rather than a dash. Nobody created it is a fact, not a gap.

  # ===========================================================================
  # The empty screen
  # ===========================================================================

  @integration
  Scenario: An organization with no environments is told where they come from
    Given no source names an environment
    And sample data is off
    When the Environments pane renders
    Then the empty state says environments appear once a source points at one

  @integration
  Scenario: Sample environments fill an empty table and say they are samples
    Given no source names an environment
    And sample data is on
    When the Environments pane renders
    Then sample rows are on screen
    And each carries the sample badge

  @integration
  Scenario: Sample environments replace discovered environments until disabled
    Given a source names an environment
    And sample data is on
    When the Environments pane renders
    Then only sample environments are listed
    When sample data is disabled
    Then the discovered environment returns
    And no sample row is shown

  # ===========================================================================
  # Adding one
  # ===========================================================================

  @integration
  Scenario: The add dialog asks for a name and a description
    Given an admin opens Add environment
    When the dialog renders
    Then it offers a name and a description
    And it cannot be submitted without a name

  @integration
  Scenario: The add dialog says the environment will not be stored
    Given an admin opens Add environment
    When the dialog renders
    Then it says the environment is not stored and is gone on reload
    # Said where they are about to act on it. This is the whole reason the
    # dialog is acceptable at all.

  @integration
  Scenario: An added environment joins the table for this sitting
    Given an admin adds an environment
    When the Environments pane renders
    Then the environment is a row in the table

  # ===========================================================================
  # The tab
  # ===========================================================================

  @integration
  Scenario: The Environments tab sits between Catalog and Sources
    Given the Inventory page renders
    When the tab strip renders
    Then the tabs read Catalog, Environments, Sources and Anomaly rules
    And there is no Approvals tab
