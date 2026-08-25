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

  Scenario: Version history preserves the Studio response
    Given a workflow has current, latest, published and parent versions
    When the service lists its version history
    Then it returns the author and sparse version tags
    And it includes DSL only in the requested history mode

  Scenario: Restoring an old version migrates its graph
    Given a persisted workflow version uses an older graph shape
    When the service restores that version
    Then it migrates the graph through the application port
    And updates the current pointer and display metadata together

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
