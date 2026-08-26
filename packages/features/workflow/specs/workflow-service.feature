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

  Scenario: Studio and execution share graph migration
    Given a persisted workflow version uses an older graph shape
    When Studio or execution materialises that version
    Then it uses the Workflow contract migration
    And both paths produce the same current DSL shape

  Scenario: Studio execution events use one portable wire contract
    Given Studio dispatches a component, flow, evaluation, or optimization event
    When a browser or server consumes the event
    Then it validates the same Zod 4 contract and optimizer parameter shape

  Scenario: New Studio workflows use portable templates and entry defaults
    Given a user creates a blank or custom-evaluator workflow
    When an inline entry dataset is materialized
    Then declared entry defaults fill only missing values
    And the browser template does not pin a resolved project model

  Scenario: Studio dataset transforms are portable browser behaviour
    Given Studio, Prompts, or execution needs to reshape a dataset
    When it converts records, fields, or train/test partitions
    Then it uses the Workflow browser surface
    And application modules retain only compatibility imports

  Scenario: Local configuration dispatch stays portable
    Given a browser or API dispatches unsaved local Studio configuration
    When it materializes execution DSL or a default LLM node
    Then it uses the Workflow contract
    And no backend imports the Workflow browser surface

  Scenario: Code-node Python language support is portable browser behaviour
    Given the Studio code or Liquid-condition editor opens
    When it completes, validates, formats, hovers, or offers quick fixes
    Then it uses the Workflow browser surface for its editor and Python providers
    And the application supplies only project-scoped secret transport and controls

  Scenario: Canvas node renderers use explicit application host ports
    Given Studio renders workflow nodes or palette entries
    When a node needs application-only execution or dataset data
    Then Workflow uses its injected browser host port

  Scenario: Canvas renderer and edge registries use the Workflow browser surface
    Given the application mounts a Workflow React Flow canvas
    When it resolves node or default-edge renderers
    Then it consumes the Workflow browser registries
    And the application retains only page and host composition

  Scenario: Node selection transitions use named application drawer ports
    Given a prompt, evaluator, or agent node is dropped on the canvas
    When the user selects, creates, or cancels the resource
    Then Workflow updates the placeholder and selection through its store
    And the application port performs only drawer navigation and callback wiring

  Scenario: Execution materializes a saved entry dataset through DatasetService
    Given a Studio execution event references a saved entry dataset
    When Workflow materializes the event with an injected DatasetService
    Then execution receives inline records without accessing application globals

  Scenario: Workflow prepares a Studio event through typed runtime ports
    Given a Studio event needs project credentials, model parameters, and datasets
    When a caller invokes prepareStudioEvent for its project
    Then Workflow enriches the event before materializing referenced datasets
    And application transports do not copy the preparation helper

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
