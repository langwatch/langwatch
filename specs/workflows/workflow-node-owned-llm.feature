Feature: Every LLM node owns its config; workflow-level default_llm is removed
  As a user on a fresh LangWatch install or a fresh organization
  I want new workflows to always carry a runnable model on their LLM nodes
  So that running a component never fails with an opaque 500

  # Customer context: on a freshly provisioned environment (no
  # ModelDefaultConfig rows seeded at any scope), creating a workflow
  # persisted `default_llm.model = ""` because the creation form used the
  # cascade-resolved default verbatim and the cascade had nothing to
  # return. Every run then 500'd with "Model provider not configured: "
  # (empty provider name — the split of an empty model string).
  #
  # The workflow-level default_llm concept is removed outright (DSL
  # spec_version 1.5): it had no reachable UI to edit it, and it existed
  # only as an execution-time fallback for LLM nodes without their own
  # config. Instead, every llm parameter owns a model:
  #   - the save path materializes missing models (cascade-resolved
  #     `workflows.create_default`, else the registry flagship constant)
  #   - legacy persisted DSLs are migrated on read, folding the old
  #     default_llm into modelless llm parameters
  #   - the engine (nlpgo) has no workflow-level fallback and fails a
  #     modelless signature node with the typed llm_model_not_set error
  # Seeding model defaults is never a precondition: prompts and scenario
  # runs already follow this exact pattern.

  Background:
    Given a project with no default models configured at any level

  # ============================================================================
  # Creation: saved workflows always carry node-owned models
  # ============================================================================

  @integration
  Scenario: Creating a workflow on a fresh install starts it with a ready-to-use model
    When the user creates a workflow from a template without picking a model
    Then the saved LLM node carries the platform's flagship model
    And the saved model is not empty

  @integration
  Scenario: Creating a workflow uses the configured default model when one is set
    Given a default model configured for the project
    When the user creates a workflow from a template without picking a model
    Then the saved LLM node carries the configured default model

  @integration
  Scenario: A workflow created by an older client keeps its old workflow-wide model
    When a workflow is created by an older client that still sends a workflow-wide model
    Then the saved LLM node carries that model
    And the saved workflow no longer has a workflow-wide model

  @integration
  Scenario: An explicit node-owned model is never rewritten
    When a workflow is created whose LLM node already carries a model
    Then the saved LLM node keeps that model

  @unit
  Scenario: Dragging a new signature node seeds it with the resolved default
    Given the studio node selection panel
    When a signature node is dragged onto the canvas
    Then its llm parameter carries the cascade-resolved model, or the registry flagship when nothing is configured

  # ============================================================================
  # Migration: legacy persisted DSLs keep working
  # ============================================================================

  @unit
  Scenario: spec_version 1.4 workflows fold default_llm into modelless LLM nodes
    Given a persisted 1.4 workflow with default_llm and an LLM node without a model
    When the DSL is migrated on read
    Then the LLM node carries the old default model and sampling params
    And the migrated DSL is spec_version 1.5 without a default_llm field

  @unit
  Scenario: A 1.4 workflow with an empty default_llm model migrates without inventing a model
    Given a persisted 1.4 workflow whose default_llm model is empty
    When the DSL is migrated on read
    Then the LLM node stays modelless
    And the run path reports the missing model clearly

  @integration
  Scenario: Published workflows saved before the change still run with their old model
    Given a published workflow saved before models lived on each node, relying on the workflow-wide model
    When it is executed through the workflow run API
    Then its LLM nodes dispatch with that model filled in

  # ============================================================================
  # Execution: a modelless node fails clearly, never an opaque 500
  # ============================================================================

  @integration
  Scenario: Running a workflow with a modelless LLM node is rejected as a fixable problem
    When an execute event reaches the server with an LLM node that has no model
    Then the run is rejected as a configuration problem the user can fix
    And the error names the node and says to choose a model
    And it is not reported as a server fault

  @unit
  Scenario: The Go engine fails a modelless signature node with a typed error
    Given a workflow reaching the engine with a signature node that has no llm parameter
    When the node executes
    Then the run fails with the llm_model_not_set error naming the node
    And the legacy top-level default_llm in the payload is ignored
