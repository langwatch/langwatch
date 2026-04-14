Feature: Sage assistant sidebar in the experiment workbench
  As a user working inside the experiment workbench
  I want to chat with an in-product AI assistant named Sage
  So that I can understand, find, and plan with evaluators without leaving the page

  Background:
    Given I am signed in with access to a project
    And I am viewing an experiment in the workbench
    And my project has at least one custom evaluator and several built-in evaluators available

  # ---------------------------------------------------------------------------
  # Opening and closing the sidebar
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Opening Sage reveals an empty chat panel
    When I open the Sage assistant
    Then a right-side chat panel appears
    And the panel shows a welcome message from Sage
    And my workbench content remains visible and usable

  @integration
  Scenario: Closing Sage collapses the panel
    Given the Sage panel is open
    When I close the Sage panel
    Then the panel is no longer visible
    And the workbench reclaims the full width

  # ---------------------------------------------------------------------------
  # Listing evaluators
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking which evaluators exist in my project
    Given the Sage panel is open
    When I ask "what evaluators do I have available?"
    Then Sage replies with a list that includes each of my project's evaluators by name
    And each evaluator in the list has a short one-line description
    And evaluators from other projects are not mentioned

  # ---------------------------------------------------------------------------
  # Explaining a specific evaluator
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking for details about a specific evaluator
    Given the Sage panel is open
    And my project has an evaluator named "Answer Relevancy"
    When I ask "how does Answer Relevancy work?"
    Then Sage's reply describes what the evaluator measures
    And Sage's reply lists the inputs the evaluator expects

  # ---------------------------------------------------------------------------
  # Suggesting an evaluator for a goal
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking Sage to suggest an evaluator for a goal
    Given the Sage panel is open
    When I describe my goal: "I want to measure hallucinations in a RAG pipeline"
    Then Sage proposes one or more evaluators that fit the goal
    And Sage explains why each suggestion fits
    And each suggestion references an evaluator that exists in my project or in the built-in catalog

  # ---------------------------------------------------------------------------
  # Read-only boundary (v1 does not take actions on the user's behalf)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Sage proposes an action but does not execute it
    Given the Sage panel is open
    When I ask "run Answer Relevancy on my current experiment"
    Then Sage does not modify the experiment
    And Sage's reply explains the steps I would take to run that evaluator myself

  # ---------------------------------------------------------------------------
  # Project isolation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Sage only sees the current project's data
    Given I belong to multiple projects
    And another project of mine has an evaluator named "Secret Eval"
    When I ask Sage "list every evaluator I have"
    Then Sage's reply does not mention "Secret Eval"

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A user without evaluation view permission cannot use Sage
    Given my role in the project does not grant evaluation view permission
    When I try to open the Sage assistant
    Then the assistant is unavailable
    And I see a message explaining I need evaluation access
