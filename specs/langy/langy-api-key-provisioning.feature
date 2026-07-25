Feature: Dedicated Langy API key provisioning
  As a project owner
  I want each of my projects to have its own dedicated, least-privilege Langy key
  So that the Langy assistant can act on my project without reusing my personal key,
  and so that a leaked key exposes only this project and only what Langy needs

  Background:
    Given I am signed in as an admin of my organization

  # ---------------------------------------------------------------------------
  # New projects
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Creating a project provisions a dedicated Langy key
    When I create a new project
    Then the project has a dedicated API key named "Langy"
    And the Langy key is separate from the project's own ingestion API key
    And the Langy key is not owned by any individual user

  @integration
  Scenario: The Langy key is scoped to only its own project
    Given I have two projects "Alpha" and "Beta"
    When a Langy key is provisioned for "Alpha"
    Then the Langy key for "Alpha" can act only within "Alpha"
    And the Langy key for "Alpha" cannot access "Beta"

  @integration
  Scenario: The Langy key grants only the access Langy needs
    When I create a new project
    Then the Langy key cannot perform organization-level administration
    And the Langy key can perform only the actions the Langy assistant requires

  # ---------------------------------------------------------------------------
  # Existing projects (backfill)
  # ---------------------------------------------------------------------------

  # Bulk backfill scripts were dropped in PR #4913 per review — Langy
  # auto-provisions its key on first use instead, so any project predating
  # the feature self-heals the moment a chat is started against it.

  @integration
  Scenario: Existing projects without a Langy key heal on first call
    Given a project that was created before Langy keys existed
    And that project has no Langy key
    When provisionLangyApiKey runs for that project (first-chat heal path)
    Then that project has a dedicated Langy key named "Langy"

  @integration
  Scenario: Repeated heal calls do not create duplicates
    Given a project that already has a Langy key
    When provisionLangyApiKey runs again for that project
    Then the project still has exactly one Langy key

  # ---------------------------------------------------------------------------
  # Lifecycle
  # ---------------------------------------------------------------------------

  # Not yet implemented — no Langy-key revoke flow exists yet; flagged so the
  # feature-parity check tolerates it until the revoke behaviour is built.
  @unimplemented
  @integration
  Scenario: An admin can revoke the Langy key
    Given my project has a Langy key
    When I revoke the Langy key
    Then the Langy key can no longer act on my project
    And my project's other API keys are unaffected

  # ---------------------------------------------------------------------------
  # The per-chat session key: the caller's own access, and never more
  # ---------------------------------------------------------------------------

  # Langy's key is issued at the "read and create" grain, and creating a
  # scenario was gated at the "manage everything" grain, so an admin who could
  # create a scenario by hand watched Langy be refused. The answer is that an
  # action asks for access at the grain it acts at — never that the assistant
  # is handed the power to delete in order to be allowed to create.
  Rule: Langy acts with the caller's own access, never more and never less

    @unit
    Scenario: Creating asks for permission to create
      Given I can create scenarios but not delete them
      When Langy creates a scenario on my behalf
      Then the scenario is created

    @unit
    Scenario: Being able to manage still lets you create
      Given I can manage scenarios
      When Langy creates a scenario on my behalf
      Then the scenario is created

    @unit
    Scenario: Langy is never granted the power to delete
      Given I can manage scenarios, which includes deleting them
      When Langy starts a chat on my behalf
      Then Langy cannot delete a scenario in this project

    @unit
    Scenario: Langy can do what the person asking can do
      Given I can create and manage scenarios in this project
      When Langy starts a chat on my behalf
      Then Langy can create a scenario in this project

    @unit
    Scenario: Langy cannot do what the person asking cannot do
      Given I can only view scenarios in this project
      When Langy starts a chat on my behalf
      Then Langy can read the scenarios in this project
      And Langy cannot create a scenario in this project

    @unit
    Scenario: Langy is never granted access outside its own remit
      Given I am an admin of this organization
      When Langy starts a chat on my behalf
      Then Langy cannot administer the organization
      And Langy cannot read or write the project's stored secrets
      And Langy cannot share traces publicly

    @unit
    Scenario: A person with no relevant access gets no key at all
      Given I hold none of the access Langy uses in this project
      When Langy starts a chat on my behalf
      Then no key is created
      And I am told plainly that my access does not cover it

    @integration
    Scenario: Reducing someone's access takes effect on keys already issued
      Given Langy holds a key issued while I could manage scenarios
      When my access is reduced to viewing scenarios
      Then that key can no longer create a scenario
      And it can still read the scenarios I can still read
