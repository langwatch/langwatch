Feature: Entry point node with optional dataset and user-defined inputs
  As a user building workflows
  I want the workflow entry to be an explicit "Entry point" with inputs I control
  So that dataset columns and workflow inputs stop being conflated

  # Customer context: people are constantly confused by the dataset node
  # doubling as the entry point - the embedded data grid makes it look
  # like a dataset is mandatory and that its columns ARE the workflow
  # inputs. The redesign: the node is the Entry point (like the End node
  # is End); a dataset CAN be attached and shows as a small marker; the
  # inputs are user-owned fields that a dataset attach merely seeds
  # (merge + dedup), and arbitrary inputs double as run/API parameters.

  Background:
    Given I am logged in
    And I have a workflow open in the optimization studio

  # ============================================================================
  # Presentation
  # ============================================================================

  @integration
  Scenario: The workflow entry presents as "Entry point"
    When I create a new workflow
    Then the first node is titled "Entry point"
    And it exposes its inputs as connectable fields

  @integration
  Scenario: A dataset is not required on the entry point
    Given the entry point has no dataset attached
    Then the entry node renders without any dataset grid
    And the workflow can still run with manually provided inputs

  @integration @unimplemented
  Scenario: An attached dataset shows as a small marker on the node
    Given a dataset "test-data" with 20 rows is attached to the entry point
    Then the entry node shows a compact dataset marker with name and row count
    And the node does not embed a data preview grid

  # ============================================================================
  # User-defined inputs
  # ============================================================================

  @integration
  Scenario: Adding an input on the entry point
    When I open the entry point drawer
    And I add an input "feature_flag" of type str
    Then the entry node exposes a "feature_flag" field to connect from

  # The entry inputs use the same modern field editor as the code and LLM
  # nodes (a compact type-icon + name row with an Add menu), so every input
  # type those nodes accept is available here too, including image.
  @integration
  Scenario: The entry point accepts an image input
    When I open the entry point drawer
    And I add an input of type image
    Then the entry node exposes an image input field

  # Like the LLM nodes, an entry input can hold an optional default value. At
  # run time the default fills the field when the dataset row or API call does
  # not provide it; a provided value always wins.
  @integration
  Scenario: An entry input can carry a default value
    When I open the entry point drawer
    And I type a default value for an input
    Then the default is stored on the input

  @integration @unimplemented
  Scenario: An entry default fills a missing field at run time
    Given an entry input "lang" with default "en"
    When the workflow runs without a "lang" value provided
    Then the run receives "lang" as "en"

  @integration
  Scenario: Attaching a dataset merges its columns into the inputs
    Given the entry point has a user-defined input "feature_flag"
    When I attach a dataset with columns "query" and "context"
    Then the entry inputs are "feature_flag", "query" and "context"
    And no duplicate inputs are created for columns already present

  @integration
  Scenario: Removing a dataset-derived input keeps the dataset attached
    Given a dataset with columns "query" and "irrelevant" is attached
    When I remove the "irrelevant" input from the entry point
    Then the dataset stays attached
    And the entry inputs no longer include "irrelevant"

  # In a workflow the entry point is the input source; the attached dataset
  # is just a seed, so a downstream node's input mapping reads from "Entry",
  # not the dataset name. (Evaluations v3 keeps the dataset-name labeling.)
  @integration
  Scenario: A workflow input maps from the entry, not the dataset name
    Given a node maps an input from the entry point
    And the entry point has a dataset attached
    Then the mapping source reads as "Entry", not the dataset name

  # ============================================================================
  # Navigation
  # ============================================================================

  @integration
  Scenario: The entry drawer links to the End node
    When I open the entry point drawer
    And I click the "End node" link
    Then the End node drawer opens

  @integration
  Scenario: The entry panel offers no optimization split
    Given a dataset is attached to the entry point
    When I open the entry point drawer
    Then no optimization or train/test split configuration is offered
    # Manual run values are picked in the run-until-here dialog instead:
    # specs/workflows/run-until-here-dialog.feature
