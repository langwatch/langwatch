Feature: Lite member access restrictions
  As a LangWatch platform owner
  I want lite members (EXTERNAL org role) to browse freely but with targeted action restrictions
  So that leadership and support users can monitor platform activity
  without accessing trace debugging or modifying configuration

  Lite members are non-technical users (leadership, customers, support).
  They can see everything a regular viewer sees but cannot create/edit
  certain resources or debug individual traces.

  Background:
    Given an organization "acme" with a project "chatbot"
    And a lite member "sarah" in organization "acme"
    And a full member "dev" in organization "acme"

  # ============================================================================
  # R1: Full UI Navigation
  # ============================================================================

  @integration
  Scenario: Lite member navigates to all platform pages without restriction
    When sarah visits each page in the platform
    Then every page loads without overlays, redirects, or access-denied screens
    And the URL is never rewritten based on her role

  @integration
  Scenario: Lite member sees all sidebar items
    When sarah logs in to the platform
    Then she sees all sidebar items
    And no items are hidden or grayed out
    And every sidebar item is clickable

  @integration
  Scenario: Lite member accesses pages beyond core observability
    When sarah navigates to prompts, datasets, workflows, annotations, and settings
    Then each page loads fully with read-only content visible

  # ============================================================================
  # R2: Trace List Viewing
  # ============================================================================

  @integration
  Scenario: Lite member views the full trace list on the messages page
    When sarah opens the messages page
    Then she sees the list of traces with summary information
    And filtering, sorting, and pagination work normally

  # ============================================================================
  # R3: Trace Detail — Partial Access
  # ============================================================================

  @integration
  Scenario: Lite member opens trace details drawer from the messages page
    Given sarah is viewing the trace list on the messages page
    When she clicks a trace row
    Then the trace detail drawer opens
    And she sees the "Thread", "Evaluations", and "Events" tabs

  @integration
  Scenario: Lite member does not see "Trace Details" or "Sequence" tabs
    Given sarah has opened a trace detail drawer
    Then the "Trace Details" tab is not visible
    And the "Sequence" tab is not visible

  @integration
  Scenario: Lite member does not see the "View Trace" hover action on messages
    Given sarah is viewing the messages page in card view
    When she hovers over a message card
    Then the "View Trace" button is not shown
    And the "Translate", "Annotate", and "Suggest" buttons are shown

  @integration
  Scenario: Lite member can create annotations with comments on traces
    Given sarah has opened a trace detail drawer
    When she clicks "Annotate" and writes a comment
    And she clicks "Save"
    Then the annotation is saved successfully
    And no restriction modal appears

  @integration
  Scenario: Lite member can suggest output on traces
    Given sarah has opened a trace detail drawer
    When she clicks "Suggest" and edits the suggested output
    And she clicks "Save"
    Then the suggestion is saved successfully
    And no restriction modal appears

  @integration
  Scenario: Lite member cannot delete annotations or manage scoring metrics
    Given sarah has opened a trace detail drawer with existing annotations
    Then she cannot delete other users' annotations
    And "Enable scoring metrics" is not actionable for her

  # ============================================================================
  # R3b: Trace Export Restriction
  # ============================================================================

  @integration
  Scenario: Lite member does not see the "Export all" button on messages page
    Given sarah is viewing the trace list on the messages page
    Then the "Export all" button is not visible

  @integration
  Scenario: Lite member clicks Export on selected traces and sees restriction modal
    Given sarah is viewing the trace list on the messages page
    And she has selected one or more traces
    When she clicks the "Export" button in the selection bar
    Then a restriction modal appears
    And no CSV download is triggered

  @integration
  Scenario: Lite member clicks "Add to Dataset" on selected traces and sees restriction modal
    Given sarah is viewing the trace list on the messages page
    And she has selected one or more traces
    When she clicks the "Add to Dataset" button in the selection bar
    Then a restriction modal appears
    And the add-to-dataset drawer does not open

  @integration
  Scenario: Lite member clicks "Add to Queue" on selected traces and sees restriction modal
    Given sarah is viewing the trace list on the messages page
    And she has selected one or more traces
    When she clicks the "Add to Queue" button in the selection bar
    Then a restriction modal appears

  @integration
  Scenario: Add-to-dataset drawer is blocked for lite members regardless of entry point
    When sarah tries to open the add-to-dataset drawer from any entry point
    Then the drawer does not open
    And a restriction modal appears

  @integration
  Scenario: Lite member does not see the "Export to CSV" button on batch evaluation results
    Given sarah is viewing batch evaluation results for an experiment
    Then the "Export to CSV" button is not visible

  # ============================================================================
  # R4: Scenario and Run Viewing
  # ============================================================================

  @integration
  Scenario: Lite member views scenario list and run results
    When sarah opens the simulations page
    Then she sees the list of all scenarios
    And she can view individual scenario details and configuration
    And scenario run history and results are visible

  @integration
  Scenario: Lite member views suite results
    When sarah opens a suite view
    Then she sees grouped scenario results
    And simulation run outcome data is displayed

  # ============================================================================
  # R5: Scenario Create/Edit Restriction
  # ============================================================================

  @integration
  Scenario: Lite member clicks create scenario and sees restriction modal
    When sarah opens the simulations page
    And she clicks the "Create Scenario" button
    Then she sees a restriction modal explaining the limitation

  @integration
  Scenario: Lite member clicks edit or delete on a scenario and sees restriction modal
    Given a scenario "happy-path" exists in project "chatbot"
    When sarah views scenario "happy-path"
    And she clicks an edit or delete action
    Then she sees a restriction modal explaining the limitation

  # ============================================================================
  # R6: Evaluation Outcome Viewing
  # ============================================================================

  @integration
  Scenario: Lite member views evaluation results
    When sarah opens the evaluations page
    Then she sees evaluation results, scores, and outcome summaries
    And historical evaluation data is accessible

  # ============================================================================
  # R7: Evaluation Create/Edit Restriction
  # ============================================================================

  @integration
  Scenario: Lite member clicks create evaluation and sees restriction modal
    When sarah opens the evaluations page
    And she clicks the create evaluation button
    Then she sees a restriction modal explaining the limitation

  @integration
  Scenario: Lite member clicks edit or delete on an evaluation and sees restriction modal
    Given an evaluation exists in project "chatbot"
    When sarah views the evaluation
    And she clicks an edit or delete action
    Then she sees a restriction modal explaining the limitation

  # ============================================================================
  # R8: Experiment Create/Edit Restriction
  # ============================================================================

  @integration
  Scenario: Lite member views experiment results and graphs
    When sarah opens the experiments page
    Then she sees experiment results and graphs

  @integration
  Scenario: Lite member clicks create experiment and sees restriction modal
    When sarah opens the experiments page
    And she clicks the create experiment button
    Then she sees a restriction modal explaining the limitation

  @integration
  Scenario: Lite member clicks edit or delete on an experiment and sees restriction modal
    Given an experiment exists in project "chatbot"
    When sarah views the experiment
    And she clicks an edit or delete action
    Then she sees a restriction modal explaining the limitation

  # ============================================================================
  # R9: Restriction Modal Content
  # ============================================================================

  @unit
  Scenario: Restriction modal uses role-based messaging
    When a restriction modal appears for sarah
    Then the title is "Feature Not Available"
    And the body explains the restriction is based on her role
    And the modal does not reference billing, plans, or pricing

  @unit
  Scenario: Restriction modal offers "Contact Admin" not "Upgrade your plan"
    When a restriction modal appears for sarah
    Then the available actions are "Contact Admin" and "Dismiss"
    And there is no "Upgrade your plan" call to action

  # ============================================================================
  # R10: Consistent Restriction UX Pattern
  # ============================================================================

  @integration
  Scenario: All create/edit actions trigger restriction modal on click
    When sarah clicks a create or edit action on any restricted page
      | page                |
      | simulations         |
      | evaluations         |
      | experiments         |
    Then the restriction modal appears each time
    And the page never shows an empty or broken state
    And she can dismiss the modal and continue browsing

  @integration
  Scenario: Backend serves as safety net for bypassed mutations
    When a restricted mutation reaches the backend from sarah's session
    Then the server returns an UNAUTHORIZED error with a LiteMemberRestrictedError cause
    And the global error handler opens the restriction modal

  # ============================================================================
  # Command bar restrictions
  # ============================================================================

  @integration
  Scenario: Command bar hides create actions for lite members
    When sarah opens the command bar
    Then create actions like "New Scenario" and "New Dataset" are not available
    And navigation actions to existing pages remain available

  # ============================================================================
  # Other restricted actions trigger the same restriction modal
  # ============================================================================

  @integration
  Scenario: Lite member clicks create on prompts or datasets and sees restriction modal
    When sarah navigates to prompts or datasets
    And she clicks a create button
    Then she sees a restriction modal explaining the limitation
    And existing prompts and datasets are fully viewable

  @integration
  Scenario: Lite member clicks edit on settings and sees restriction modal
    When sarah opens the settings page
    And she clicks a save or edit control
    Then she sees a restriction modal explaining the limitation

  # ============================================================================
  # Full members are unaffected
  # ============================================================================

  @integration
  Scenario: Full member retains all capabilities
    When dev logs in to the platform
    Then dev can view, create, edit, and delete all resources
    And dev sees all trace detail tabs including "Trace Details" and "Sequence"
    And dev sees the "View Trace" hover action on messages
    And dev experiences no restriction modals or disabled buttons

  # ============================================================================
  # Code-created resources are visible to lite members
  # ============================================================================

  @integration
  Scenario: Scenarios created via SDK are visible to lite members
    Given dev creates a scenario via the Python SDK
    When sarah opens the simulations page
    Then she sees the SDK-created scenario and its results

  @integration
  Scenario: Evaluations run via SDK are visible to lite members
    Given dev runs an evaluation via the SDK
    When sarah opens the evaluations page
    Then she sees the SDK-created evaluation results

  # ============================================================================
  # No regression in license enforcement
  # ============================================================================

  @integration
  Scenario: License limit enforcement is unaffected by lite member changes
    Given the organization has reached a plan limit
    When a full member triggers the limit
    Then they see the standard upgrade modal with plan/billing information
    And the lite member restriction modal is not shown
