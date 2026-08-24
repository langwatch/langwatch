Feature: Workflow service boundary

  Scenario: A workflow definition is versioned through one service
    Given a valid workflow DSL
    When the Workflow service creates the workflow
    Then it persists the definition and its first version
    And callers receive portable Workflow contract values

  Scenario: Published version selection is tenant scoped
    Given a workflow with a published version in a project
    When the service resolves its published version
    Then it returns that version
    And a workflow from another project is not visible

  Scenario: Copying referenced datasets uses the Dataset service
    Given a workflow copy includes referenced datasets
    When Workflow copies the definition into another project
    Then it calls the canonical Dataset service
    And it does not access the Dataset repository

  Scenario: Evaluation remains application composition
    Given a caller requests `/workflows/:id/evaluate`
    When the API handles the request
    Then it composes Workflow version selection with Evaluation execution
    And Workflow does not own the evaluation run lifecycle
