@integration
Feature: Online Evaluation Drawer
  As a user
  I want to create and configure online evaluations in a drawer
  So that I can monitor traces and threads with evaluators

  # All 15 @unimplemented scenarios remain unbound — per AUDIT_MANIFEST.md
  # all are DUPLICATE / DELETE / UPDATE classifications:
  # - "Open drawer from menu": DUPLICATE of NewIssues "shows New Online Evaluation header".
  # - "Default state is trace level": DELETE — impl changed to "no level selected by default".
  # - "Select trace level evaluation" / "Select thread level evaluation": KEEP per manifest
  #   for trace-level mapping sources (only partially covered).
  # - "Open evaluator list from selection box": DUPLICATE of "opens evaluator list when
  #   clicking Select Evaluator".
  # - "Select evaluator with auto-mapped fields": DUPLICATE of online-evaluation-drawer-flow
  #   "Create trace-level online evaluation with auto-mappings".
  # - "Select evaluator with pending mappings": DUPLICATE of flow.feature
  #   "Create with pending mappings that need configuration".
  # - "Name field defaults to evaluator name": DUPLICATE of test
  #   "pre-fills name with evaluator name when name is empty".
  # - "Configure sampling": UPDATE — default is 1.0 not 0.5; needs UI semantics rewrite.
  # - "Configure preconditions" / "Preconditions filter trace execution": DUPLICATE of
  #   online-evaluation-preconditions feature scenarios.
  # - "Save online evaluation": DUPLICATE of EditSave "Save functionality - Create mode" suite.
  # - "Cannot save without evaluator": DUPLICATE of NewIssues "Create button is disabled when
  #   no evaluator selected".
  # - "Cannot save without name": DUPLICATE of NewIssues "Create button is disabled when
  #   name is empty".
  # - "Clear selected evaluator": DUPLICATE of "clears evaluator selection when clicking
  #   Remove Selection".
  # Aspirational pending DELETE/UPDATE rewrites + KEEP test additions tracked in PR #3458.

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  @unimplemented
  Scenario: Open drawer from menu
    Given I am on the evaluations page
    When I select "New Online Evaluation" from the menu
    Then the online evaluation drawer should open
    And the drawer should have a header "New Online Evaluation"

  @unimplemented
  Scenario: Default state is trace level
    Given the online evaluation drawer is open
    Then "Trace" level should be selected by default
    And the evaluator selection box should show "Select Evaluator"

  @unimplemented
  Scenario: Select trace level evaluation
    Given the online evaluation drawer is open
    When I select "Trace" level
    Then trace-level mapping sources should be available
    And sources should include input, output, contexts, metadata, spans

  @unimplemented
  Scenario: Select thread level evaluation
    Given the online evaluation drawer is open
    When I select "Thread" level
    Then thread-level mapping sources should be available
    And sources should include thread_id and traces array

  @unimplemented
  Scenario: Open evaluator list from selection box
    Given the online evaluation drawer is open
    When I click on the evaluator selection box
    Then the evaluator list drawer should open
    And I should see my existing evaluators

  @unimplemented
  Scenario: Select evaluator with auto-mapped fields
    Given the drawer is open with trace level selected
    And I have an evaluator "Exact Match" requiring "input" and "output"
    When I select this evaluator from the list
    Then the evaluator list drawer should close
    And I should return to the Online Evaluation drawer
    And "Exact Match" should be shown in the evaluator box
    And "input" should auto-map to trace.input
    And "output" should auto-map to trace.output
    And no pending mapping warning should appear

  @unimplemented
  Scenario: Select evaluator with pending mappings
    Given the drawer is open with trace level selected
    And I have an evaluator requiring "expected_output"
    When I select this evaluator from the list
    Then the evaluator editor drawer should open automatically
    And "expected_output" should be highlighted as pending
    And I should see a yellow/orange border on the mapping input

  @unimplemented
  Scenario: Name field defaults to evaluator name
    Given I have selected an evaluator named "PII Detection"
    Then the name field should be pre-filled with "PII Detection"
    And I should be able to edit the name

  @unimplemented
  Scenario: Configure sampling
    Given the online evaluation drawer is open with evaluator selected
    When I set sampling to 50%
    Then the sample value should be 0.5
    And the slider should show 50%

  @unimplemented
  Scenario: Configure preconditions
    Given the online evaluation drawer is open with evaluator selected
    When I add a precondition with:
      | field | input    |
      | rule  | contains |
      | value | customer |
    Then the precondition should be added to the list
    And I should be able to remove it

  @unimplemented
  Scenario: Preconditions filter trace execution
    Given a monitor with precondition:
      | field | metadata.labels |
      | rule  | contains        |
      | value | production      |
    When a trace arrives with labels ["production", "api"]
    Then the evaluation should run
    When a trace arrives with labels ["staging"]
    Then the evaluation should be skipped

  @unimplemented
  Scenario: Save online evaluation
    Given I have configured all required fields
    And the evaluator is selected with complete mappings
    And the name is set
    When I click "Save"
    Then a monitor should be created with evaluatorId reference
    And the monitor should have the configured mappings
    And the drawer should close

  @unimplemented
  Scenario: Cannot save without evaluator
    Given the online evaluation drawer is open
    And no evaluator is selected
    Then the Save button should be disabled
    And a message should indicate "Select an evaluator to continue"

  @unimplemented
  Scenario: Cannot save without name
    Given the online evaluation drawer is open
    And an evaluator is selected
    But the name field is empty
    Then the Save button should be disabled

  @unimplemented
  Scenario: Clear selected evaluator
    Given I have selected an evaluator
    When I click the X button on the evaluator box
    Then the evaluator should be removed
    And the box should show "Select Evaluator"
    And the Save button should be disabled
