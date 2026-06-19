Feature: Langy assistant sidebar in the experiment workbench
  As a user working inside the experiment workbench
  I want to chat with an in-product AI assistant named Langy
  So that I can understand, find, and plan with evaluators without leaving the page

  Background:
    Given I am signed in with access to a project
    And I am viewing an experiment in the workbench
    And my project has at least one custom evaluator and several built-in evaluators available

  # ---------------------------------------------------------------------------
  # Opening and closing the sidebar
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Opening Langy reveals an empty chat panel
    When I open the Langy assistant
    Then a right-side chat panel appears
    And the panel shows a welcome message from Langy
    And my workbench content remains visible and usable

  @integration
  Scenario: Closing Langy collapses the panel
    Given the Langy panel is open
    When I close the Langy panel
    Then the panel is no longer visible
    And the workbench reclaims the full width

  # ---------------------------------------------------------------------------
  # Listing evaluators
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking which evaluators exist in my project
    Given the Langy panel is open
    When I ask "what evaluators do I have available?"
    Then Langy replies with a list that includes each of my project's evaluators by name
    And each evaluator in the list has a short one-line description
    And evaluators from other projects are not mentioned

  # ---------------------------------------------------------------------------
  # Explaining a specific evaluator
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking for details about a specific evaluator
    Given the Langy panel is open
    And my project has an evaluator named "Answer Relevancy"
    When I ask "how does Answer Relevancy work?"
    Then Langy's reply describes what the evaluator measures
    And Langy's reply lists the inputs the evaluator expects

  # ---------------------------------------------------------------------------
  # Suggesting an evaluator for a goal
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Asking Langy to suggest an evaluator for a goal
    Given the Langy panel is open
    When I describe my goal: "I want to measure hallucinations in a RAG pipeline"
    Then Langy proposes one or more evaluators that fit the goal
    And Langy explains why each suggestion fits
    And each suggestion references an evaluator that exists in my project or in the built-in catalog

  # ---------------------------------------------------------------------------
  # Read-only boundary (v1 does not take actions on the user's behalf)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Langy proposes an action but does not execute it
    Given the Langy panel is open
    When I ask "run Answer Relevancy on my current experiment"
    Then Langy does not modify the experiment
    And Langy's reply explains the steps I would take to run that evaluator myself

  # ---------------------------------------------------------------------------
  # Project isolation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Langy only sees the current project's data
    Given I belong to multiple projects
    And another project of mine has an evaluator named "Secret Eval"
    When I ask Langy "list every evaluator I have"
    Then Langy's reply does not mention "Secret Eval"

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A user without evaluation view permission cannot use Langy
    Given my role in the project does not grant evaluation view permission
    When I try to open the Langy assistant
    Then the assistant is unavailable
    And I see a message explaining I need evaluation access
