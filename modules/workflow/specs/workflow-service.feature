Feature: Workflow service boundary

  @unit
  Scenario: An archived workflow keeps its evaluator publication behaviour
    Given an archived workflow whose publication row still exists
    When a caller saves it as an evaluator
    Then the publication flags and evaluator use that row's name

  @unit
  Scenario: Saving a missing workflow as an evaluator refuses before publication changes
    Given no workflow publication row exists for the requested project and id
    When a caller saves it as an evaluator
    Then workflow_not_found is reported and no publication changes

  Scenario: Linked features discover workflow fields without reading workflow tables
    Given a project has valid, invalid and archived workflow graphs
    When a peer lists fields for those workflow identifiers
    Then one project-scoped batch excludes archived workflows
    And invalid graphs report unresolved fields
    And valid graphs preserve all declared input and output identifiers

  Scenario: A failed peer copy removes only the newly copied workflow
    Given a copied workflow has current and latest version pointers and version parentage
    When the peer deletes its uncommitted workflow in the target project
    Then version pointers and parentage are cleared before deleting versions
    And the workflow is deleted last
    And every write is constrained to the target project

  @unit
  Scenario: A workflow definition is versioned through one service
    Given a valid workflow DSL
    When the Workflow service creates the workflow
    Then it persists the definition and its first version
    And callers receive portable Workflow contract values

  @unit
  Scenario: A workflow created as an autosave keeps one version across later autosaves
    Given a workflow created with its first version marked autosaved
    When a second autosave is written into it
    Then the first version is updated in place and the workflow still has one version

  @unit
  Scenario: Published version selection is tenant scoped
    Given a workflow with a published version in a project
    When the service resolves its published version
    Then it returns that version
    And a workflow from another project is not visible

  @unit @regression
  Scenario: Running a named version of an unpublished workflow is refused as not published
    Given a workflow with a saved version that was never published
    When a caller runs that version by its id
    Then the run is refused as not published before any version is read

  @unit
  Scenario: Version history preserves the Studio response
    Given a workflow has current, latest, published and parent versions
    When the service lists its version history
    Then it returns the author and sparse version tags
    And it includes DSL only in the requested history mode

  @unit
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

  @unit
  Scenario: New Studio workflows use portable templates and entry defaults
    Given a user creates a blank or custom-evaluator workflow
    When an inline entry dataset is materialized
    Then declared entry defaults fill only missing values
    And the browser template does not pin a resolved project model

  Scenario: Workflow creation import is portable browser behaviour
    Given a user opens the workflow creation dialog
    When they select a template or import a valid workflow file
    Then Workflow Web owns the selection and file validation
    And application composition supplies the create mutation and routing

  Scenario: Workflow management cards keep transport in application composition
    Given the workflow list displays a saved workflow
    When the user opens its sync, push, copy or delete actions
    Then Workflow Web renders the card and action menu
    And application composition performs project queries, mutations and dialogs

  Scenario: Studio result presentation keeps transport in application composition
    Given Studio displays workflow evaluation results
    When the panel is loading, waiting, failed, or showing a selected run
    Then Workflow Web owns the panel state and layout
    And application composition supplies project queries and Experiment renderers

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

  Scenario: The canvas resolves its renderers from the Workflow browser surface
    Given the Workflow browser surface mounts the React Flow canvas
    When it resolves node or default-edge renderers
    Then node renderers come from the Workflow node registry
    And the single default edge renderer is wrapped inline
    And the application retains only page and host composition

  @unit
  Scenario: Node selection transitions use named drawer host ports
    Given a prompt, evaluator, or agent node is dropped on the canvas
    When the user selects, creates, or cancels the resource
    Then Workflow updates the placeholder and selection through its store
    And the injected drawer port performs only navigation and callback wiring

  @unit
  Scenario: Execution materializes a saved entry dataset through DatasetService
    Given a Studio execution event references a saved entry dataset
    When Workflow materializes the event with an injected DatasetService
    Then execution receives inline records without accessing application globals

  Scenario: Workflow prepares a Studio event through typed runtime ports
    Given a Studio event needs project credentials, model parameters, and datasets
    When a caller invokes prepareStudioEvent for its project
    Then Workflow enriches the event before materializing referenced datasets
    And application transports do not copy the preparation helper

  @unit
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

  Scenario: Execution dispatch is a Workflow server concern
    Given Workflow resolves a version to run
    When the server executor dispatches it through injected nlpgo infrastructure
    Then it validates required entry inputs and model credentials
    And application composition supplies nlpgo and model-provider adapters

  @unit
  Scenario: Copying from a project the caller cannot create workflows in is refused
    Given the caller cannot create workflows in the source project
    When they copy a workflow from it
    Then permission_denied is reported with status 401 and nothing is copied

  @unit
  Scenario: A workflow that is not a copy has nothing to sync from
    Given a workflow that was never copied from another
    When the caller syncs it from its source
    Then workflow_not_a_copy is reported with status 400

  @unit
  Scenario: A synced copy continues its own version history
    Given a copy at version 4.2 whose source the caller may view
    When the caller syncs it from its source
    Then the source graph is written into the copy as version 5

  @unit
  Scenario: A push reaching no copy the caller may update is refused
    Given every copy lives in a project the caller cannot update
    When the caller pushes to the copies
    Then permission_denied is reported with status 401 and no copy changes

  @unit
  Scenario: A push with nothing to push to is refused
    Given a workflow nothing has been copied from
    When the caller pushes to its copies
    Then workflow_has_no_copies is reported with status 400

  @unit
  Scenario: Listing the copies of a missing workflow answers not found
    Given no workflow with the requested id in the project
    When the caller lists its copies
    Then workflow_not_found is reported with status 404

  @unit
  Scenario: Restoring a version the project does not hold answers not found
    Given no workflow version with the requested id in the project
    When the caller restores it
    Then workflow_version_not_found is reported with status 404

  @unit
  Scenario: A Studio graph saved without execution state is accepted as main accepted it
    Given a Studio workflow DSL that carries no state field
    When the Studio schema parses it
    Then the graph parses with an empty state

  @unit
  Scenario: Evaluator workflows are listed with only their published version
    Given a project holding evaluator workflows, one published and one never published, and a plain workflow
    When the evaluator workflows are listed
    Then each evaluator workflow comes back carrying only the version it published
    And an evaluator workflow that never published comes back with no version
    And no workflow of another project comes back

  @unit
  Scenario: Archiving a workflow takes its evaluators, agents and monitors with it
    Given a workflow backs an evaluator that a monitor uses, and an agent runs it
    When the workflow is archived with its dependants
    Then the monitor is deleted, the evaluator and the agent are archived, then the workflow

  @unit
  Scenario: The workflows list reads copy lineage on a process that supplies only declared members
    Given the workflow module is installed from its declared members alone
    When the project's workflows are listed with their copy lineage
    Then the list answers instead of failing on a member the process never supplied

  @unit
  Scenario: An evaluation run is judged against an API key's own bindings
    Given an API key that no user owns but that is bound to the project
    When it asks to evaluate a workflow
    Then the authz peer is asked about the key at that project with no user

  @unit
  Scenario: The Studio event door hands the app the signed-in browser session
    Given an editor with a browser session
    When it posts a Studio event
    Then the app receives that session's user rather than nobody

  @unit
  Scenario: A workflow run calls LangWatch with a key minted for that run, never the project key
    Given a member who may run workflows in a project
    When the member starts a workflow run that calls LangWatch's own endpoints
    Then the run carries a key minted for that run, bound to the project and owned by the member
    And the project's legacy key is not in the run
    And the key lives 15 minutes and is retired by the api-key sweep once it has lapsed

  @unit
  Scenario: Every call a run makes back into LangWatch acts as the user who started it
    Given a member who holds some, but not all, of the permissions of a project
    When the member's workflow run calls LangWatch with its minted key
    Then each call is judged as that member
    And the key carries no permission the member does not hold

  @unit
  Scenario: A run's key carries only the permissions the run uses
    Given a graph with no evaluator node and no node that runs another workflow
    When the run's key is minted
    Then it carries trace creation alone
    And an evaluator node adds evaluations, and a node that runs another workflow adds workflows

  @unit
  Scenario: A run is refused before it starts when its starter may not run evaluations
    Given a member who does not hold evaluations:manage on the project
    When the member starts a run whose graph has an evaluator node
    Then api_key_permission_denied names evaluations:manage
    And no key is minted and nothing is dispatched

  @unit
  Scenario: A long run keeps calling LangWatch past 15 minutes
    Given a run that outlives the key it started with
    When the run asks for a key with less than 5 minutes of life left on the one it holds
    Then a fresh key is minted for the same member, project and permissions
    And a key with at least 5 minutes left is reused, and never lent to a narrower or different run

  Scenario: The run's key stops working after the run ends
    Given a workflow run carrying its own minted key
    When 15 minutes have passed since the key was minted
    Then a call made with it is refused
    And the api-key sweep revokes it
    And a run that never finishes loses the key when its lifetime lapses

  @unit
  Scenario: A run nobody started calls LangWatch with a project key holding only what it needs
    Given a monitor, an online evaluation or a scenario run that no member started
    When its workflow, evaluator or scenario target is prepared to run
    Then the run carries a 15 minute key with no owner, bound to the project
    And the key holds only the permissions the graph or target uses
    And the project's legacy key is not in the run

  @unit
  Scenario: A run nobody started in a personal workspace acts as the system, not the owner
    Given a monitor in a member's personal workspace
    When its run's key is minted
    Then the key has no owner and no creator
    And none of its calls act as the workspace owner or borrow their grants

  @unit
  Scenario: A starter who loses a permission is refused even while a key minted for them lives
    Given a key minted for a member's run holding evaluations:manage, with most of its life left
    And the member then loses evaluations:manage
    When the member starts another run that needs it
    Then api_key_permission_denied names evaluations:manage before the run starts
    And the held key is not handed out

  @unit
  Scenario: A run started with a personal access token holds no more than that token
    Given a member who holds workflows:manage on the project
    And a personal access token of theirs that does not hold it
    When the token starts a run whose graph runs another workflow
    Then api_key_permission_denied names workflows:manage before the run starts
    And no key is minted

  @unit
  Scenario: A run started with a CLI access token is bounded by the person alone
    Given a member signed in through the CLI or the hosted MCP with a project-bound access token
    When the token starts a run
    Then the run names no calling key, since no key row stands behind the token
    And the run's key is minted holding what the member and the run both hold

  @unit
  Scenario: A caller cannot ask for a run key that outlives an hour
    Given a caller asking for a run key with more than an hour of life left
    When the key is minted
    Then the request is refused and no key is minted

  @unit
  Scenario: A dispatch never holds a key that lapses before the dispatch can end
    Given a run dispatched to the Lambda fleet, whose invocation may last 900 seconds
    When its run key is minted or reused
    Then the key has at least 900 seconds plus a minute left when handed out
    And a self-hosted dispatch's key has at least 15 minutes left
