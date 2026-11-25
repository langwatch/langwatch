Feature: The public API creates every kind of evaluator the editor can
  A team that keeps its evaluators in a repository and syncs them through the
  REST API, the SDKs or the CLI must be able to create each kind the editor
  creates: a built-in evaluator, a custom code evaluator, and one that wraps a
  workflow. Each is stored in the same shape the editor stores, so the editor,
  experiments, monitors and versioning treat it the same way wherever it came from.

  # The failure this pins: POST /api/evaluators only knew built-in evaluators.
  # It demanded config.evaluatorType from the built-in catalogue and stored
  # every row as type "evaluator", so a custom code evaluator could only be
  # created in the editor and filled in through the update route afterwards.

  @integration
  Scenario: The REST create makes a custom code evaluator
    When I POST an evaluator with type "code" and a config carrying code and inputs
    Then the request succeeds
    And the application is asked to create a code evaluator with that config
    And no built-in evaluatorType is demanded

  @unit
  Scenario: A code evaluator created through the API is stored like one the editor saved
    When a code evaluator is created through the API without outputs
    Then it is stored with type "code"
    And its config carries the code, the inputs and the fixed result fields
    And no model is resolved for it
    And it has a first version like any other evaluator

  @integration
  Scenario: The REST create refuses a code evaluator without a runnable program
    When I POST an evaluator with type "code" and a config missing its code or inputs
    Then the request fails as a validation error naming the missing config field
    And nothing is created

  @integration
  Scenario: The REST create refuses result fields outside the evaluator contract
    When I POST a code evaluator whose outputs name a field that is not passed, score, label or details
    Then the request fails as a validation error naming config.outputs
    And nothing is created

  @integration
  Scenario: A code evaluator's platform link opens the code editor
    When the API answers with a code evaluator
    Then its platformUrl opens the code evaluator editor, as the evaluators page does
    And a built-in evaluator's platformUrl still opens the evaluator editor

  @integration
  Scenario: The REST create makes an evaluator that wraps a workflow
    When I POST an evaluator with type "workflow" and a workflowId
    Then the application is asked to create a workflow evaluator linked to that workflow

  @integration
  Scenario: The REST create refuses a workflow evaluator without its workflow
    When I POST an evaluator with type "workflow" and no workflowId
    Then the request fails as a validation error naming workflowId
    And nothing is created

  @unit
  Scenario: The public API publishes the wrapped workflow as an evaluator
    Given a workflow of my project with no evaluator yet
    When the public API creates a workflow evaluator linked to it
    Then the workflow is flagged as an evaluator and not a component, as the Studio switch flags it
    And a create the application refuses leaves the workflow's flags as they were

  @unit
  Scenario: The public API refuses a workflow evaluator for a workflow that does not exist
    When the public API creates a workflow evaluator linked to an unknown workflow id
    Then workflow_not_found is reported with status 404
    And no evaluator is stored and no workflow's flags change

  @unit
  Scenario: The public API refuses a workflow evaluator for another project's workflow
    Given a workflow that belongs to another project
    When the public API creates a workflow evaluator in my project linked to it
    Then workflow_not_found is reported with status 404
    And no evaluator is stored and no workflow's flags change

  @unit
  Scenario: The application refuses an evaluator kind that does not match its workflow link
    Given a caller that reaches the application without the REST schema
    When it creates a workflow evaluator with no workflowId, or a code or built-in one with a workflowId
    Then the create fails as a validation error naming workflowId
    And nothing is stored

  @integration
  Scenario: A create that names no type still makes a built-in evaluator
    When I POST an evaluator with no type and a config naming a built-in evaluatorType
    Then the application is asked to create a built-in evaluator as before

  @unit
  Scenario: The CLI creates a code evaluator from a Python file
    When I run "langwatch evaluator create 'Exact' --code check.py --input output --input expected_output"
    Then the create request is sent with type "code", the file's code and those inputs
    And no built-in evaluator type is required

  @unit
  Scenario: The CLI refuses input declarations a code evaluator cannot take
    When I run "langwatch evaluator create" with "--input output:str:extra", or "--input" beside a built-in "--type"
    Then the command fails as a validation error before calling the API

  @unit
  Scenario: The TypeScript SDK creates a code evaluator
    When the SDK creates an evaluator with type "code" and a code config
    Then the create request carries the type and the config unchanged

  @unit
  Scenario: The Python SDK creates a code evaluator
    When the Python SDK creates an evaluator with type "code" and a code config
    Then the create request carries the type and the config unchanged

  @unit
  Scenario: The MCP tool creates a code evaluator
    When the platform_create_evaluator tool is called with type "code" and a code config
    Then the create request carries the type and the config unchanged
