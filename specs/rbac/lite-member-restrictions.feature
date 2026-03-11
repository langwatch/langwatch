Feature: Lite member access restrictions
  As a LangWatch platform owner
  I want lite members (EXTERNAL org role) restricted to observability and execution
  So that leadership and support users can monitor and trigger runs
  without accessing engineering-level debugging or configuration tools

  Lite members are non-technical users (leadership, customers, support).
  Engineers are full members. Both contribute data visible in the platform.

  Background:
    Given an organization "acme" with a project "chatbot"
    And a lite member "sarah" in organization "acme"
    And a full member "dev" in organization "acme"

  # ============================================================================
  # What lite members CAN see
  # ============================================================================

  Scenario: Lite member views analytics dashboards
    When sarah opens the analytics page
    Then she sees the full analytics dashboard

  Scenario: Lite member views the traces list
    When sarah opens the messages page
    Then she sees the list of traces

  Scenario: Lite member views scenario results
    When sarah opens the simulations page
    Then she sees scenario results and run history

  Scenario: Lite member views evaluation outcomes
    When sarah opens the evaluations page
    Then she sees evaluation results and scores

  Scenario: Lite member views experiment results
    When sarah opens the experiments page
    Then she sees experiment results and graphs

  Scenario: Lite member browses the full sidebar
    When sarah logs in to the platform
    Then she sees all sidebar items
    And no items are hidden or grayed out

  # ============================================================================
  # What lite members CAN do
  # ============================================================================

  Scenario: Lite member runs an existing scenario against a connected agent
    Given a scenario "happy-path" exists in project "chatbot"
    And an agent is connected to the project
    When sarah runs scenario "happy-path"
    Then the scenario executes against the agent
    And sarah sees the results

  # ============================================================================
  # What lite members CANNOT do — trace debugging
  # ============================================================================

  Scenario: Lite member cannot debug individual traces
    When sarah tries to open a trace detail view to inspect spans
    Then she sees a restriction modal explaining the limitation
    And no trace debug data is shown

  # ============================================================================
  # What lite members CANNOT do — create or edit from the platform
  # ============================================================================

  Scenario: Lite member cannot create a scenario
    When sarah tries to create a new scenario
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot edit a scenario
    Given a scenario "happy-path" exists
    When sarah tries to edit scenario "happy-path"
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot create an evaluation
    When sarah tries to create a new evaluation
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot create an experiment
    When sarah tries to create a new experiment
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot create or edit prompts
    When sarah tries to create a new prompt
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot create or edit datasets
    When sarah tries to create a new dataset
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot create or edit workflows
    When sarah tries to create a new workflow
    Then she sees a restriction modal explaining the limitation

  Scenario: Lite member cannot manage team settings
    When sarah tries to modify team settings
    Then she sees a restriction modal explaining the limitation

  # ============================================================================
  # Restriction UX
  # ============================================================================

  Scenario: Restriction modal explains the limitation clearly
    When sarah triggers any restricted action
    Then a modal appears with title "Feature Not Available"
    And the modal explains the action is not available for her role
    And the modal offers a path to upgrade or contact an admin

  Scenario: Restricted action preserves the current page URL
    Given sarah is on the scenarios page viewing results
    When she tries to create a new scenario
    Then the restriction modal appears
    And the URL does not change
    And she can dismiss the modal and continue browsing results

  # ============================================================================
  # Full members are unaffected
  # ============================================================================

  Scenario: Full member retains all capabilities
    When dev logs in to the platform
    Then dev can view, create, edit, and delete all resources
    And dev can debug individual traces
    And dev experiences no restriction modals

  # ============================================================================
  # Code-created resources are visible to lite members
  # ============================================================================

  Scenario: Scenarios created via SDK are visible to lite members
    Given dev creates a scenario via the Python SDK
    When sarah opens the simulations page
    Then she sees the SDK-created scenario and its results

  Scenario: Evaluations run via SDK are visible to lite members
    Given dev runs an evaluation via the SDK
    When sarah opens the evaluations page
    Then she sees the SDK-created evaluation results
