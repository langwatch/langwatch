Feature: Simulation run model resolution per target type
  As a LangWatch user running scenario simulations
  I want a run to resolve and validate only the models it will actually call
  So that a project whose coding-assistant default is a codex model can still
  run simulations against every target type, not just prompts

  # ---------------------------------------------------------------------------
  # Bug (issue #6634): the prefetcher unconditionally resolved an adapter
  # model via the FAST-role "scenarios.generator" feature for every target
  # type, even though workflow / code / http targets never consume an LLM
  # key for the agent under test — they use per-node litellm_params
  # (workflow) or no model at all (http), and the code adapter's synthesized
  # workflow needs the platform API key, not an LLM credential. A project
  # that ran the Codex "apply coding defaults" action (which pins the FAST
  # role to a codex model) therefore had every non-prompt simulation fail
  # with the codex terms backstop's refusal.
  #
  # Fix: the agent-under-test model is resolved from a NEW DEFAULT-role
  # feature key ("scenarios.agent_under_test", never codex-eligible) and
  # ONLY when the target is a prompt with no model of its own. Every other
  # target type resolves nothing for the adapter role. The user-simulator
  # and judge are unaffected — they always resolve their own DEFAULT-role
  # models (scenarios.user_simulator / scenarios.judge) regardless of
  # target type, because they genuinely need a real inference model.
  #
  # Coverage matrix (target type x what resolves for the agent-under-test role):
  #
  #   | target type          | adapter-role resolution               | succeeds on a codex-FAST project |
  #   |-----------------------|----------------------------------------|-----------------------------------|
  #   | prompt, model set     | the prompt's own model (no lookup)      | yes                                |
  #   | prompt, no model      | scenarios.agent_under_test (DEFAULT)    | yes (DEFAULT is never codex)       |
  #   | workflow              | none — per-node litellm_params only     | yes                                |
  #   | code                  | none — synthesized workflow needs no LLM key | yes                            |
  #   | http                  | none — no model consumed at all         | yes                                |
  #
  #   Simulator and judge resolve scenarios.user_simulator / scenarios.judge
  #   (both DEFAULT-role) for every target type in the matrix above.
  #
  # See specs/scenarios/scenario-model-selection.feature for the simulator /
  # judge resolution contract, and specs/model-providers/codex-account-
  # provider.feature for the codex terms restriction itself.

  Background:
    Given I am logged in
    And I have access to a project with an enabled model provider

  # ============================================================================
  # What resolves, per target type
  # ============================================================================

  @unit
  Scenario: A prompt with its own model never consults the agent-under-test default
    Given a scenario whose prompt target has its own model configured
    When the run data is prefetched
    Then the prompt's own model is used for the agent under test
    And the agent-under-test resolver is never called

  @unit
  Scenario: A prompt without a model resolves the agent-under-test default
    Given a scenario whose prompt target has no model configured
    When the run data is prefetched
    Then the agent under test resolves the "scenarios.agent_under_test" model

  @unit
  Scenario: A workflow target resolves no adapter-role model
    Given a scenario run against a workflow target
    When the run data is prefetched
    Then the agent-under-test resolver is never called
    And no adapter-role model params are prepared

  @unit
  Scenario: A code target resolves no adapter-role model
    Given a scenario run against a code target
    When the run data is prefetched
    Then the agent-under-test resolver is never called
    And no adapter-role model params are prepared

  @unit
  Scenario: An HTTP target resolves no adapter-role model and consumes no project key
    Given a scenario run against an HTTP target
    When the run data is prefetched
    Then the agent-under-test resolver is never called
    And no adapter-role model params are prepared
    And the HTTP adapter factory is not given a project API key

  @unit
  Scenario: The user-simulator and judge always resolve their own models
    Given a scenario run against any target type
    When the run data is prefetched
    Then the user-simulator resolves "scenarios.user_simulator"
    And the judge resolves "scenarios.judge"

  # ============================================================================
  # The codex-coding-default seam
  # ============================================================================

  @integration
  Scenario: A project whose FAST/coding default is codex still runs workflow, code, and http simulations
    Given a project whose FAST role default is a codex model
    And the same project has a non-codex DEFAULT role default
    When a scenario run is prefetched for a workflow target
    Then the prefetch succeeds
    When a scenario run is prefetched for a code target
    Then the prefetch succeeds
    When a scenario run is prefetched for an HTTP target
    Then the prefetch succeeds
    # Regression pin: the failure this replaces reported
    # `"<model>" serves the coding-assistant surfaces only …` — that message
    # must never again reach a non-prompt prefetch result.

  @unit
  Scenario: A FAST-only-codex project still resolves the DEFAULT-role agent-under-test key for prompts
    Given a project whose FAST role default is a codex model
    And the same project has a non-codex DEFAULT role default
    When a scenario run is prefetched for a prompt target with no model
    Then the prefetch succeeds
    And the agent under test resolves the non-codex DEFAULT model

  # ============================================================================
  # Credentials: the platform key, not an LLM key
  # ============================================================================

  @unit
  Scenario: The workflow adapter sends the project's platform API key, not an LLM key
    Given a workflow target whose adapter-role LLM key differs from the project's API key
    When the adapter sends its execute_flow request
    Then the request body's workflow.api_key is the project's platform API key
    And it is not the adapter-role LLM key

  @unit
  Scenario: The code adapter sends the project's platform API key, not an LLM key
    Given a code target whose adapter-role LLM key differs from the project's API key
    When the adapter sends its execute_flow request
    Then the request body's workflow.api_key is the project's platform API key
    And it is not the adapter-role LLM key

  @unit
  Scenario: Per-node workflow model credentials are untouched by the platform-key fix
    Given a workflow whose nodes already carry their own litellm_params
    When the run data is prefetched
    Then every node's litellm_params in the emitted DSL are unchanged
    # Only the top-level workflow.api_key (used by nlpgo to call back into
    # the platform) moves to the project key. Per-node LLM credentials keep
    # riding their own hydrated litellm_params.

  @unit
  Scenario: A workflow node still pinned to a restricted model correctly fails
    Given a workflow node whose litellm_params reference a codex model outside its allowed surface
    When the run data is prefetched
    Then the prefetch fails
    And the failure names that node's model

  # ============================================================================
  # Rollout: the child-process job payload
  # ============================================================================

  # Schema-level contract is bound in childProcessJobData.schema.unit.test.ts; the
  # real-spawn proof runs as post-fix verification. Tracked in #6634.
  @integration @unimplemented
  Scenario: A workflow run with no adapter-role model params still builds real simulator and judge models
    Given a workflow target whose job payload carries no adapter-role model params
    When the child process executes the job
    Then the user-simulator model is built from its own model params
    And the judge model is built from its own model params
    And neither model is ever undefined
    # A real child-process spawn (tsx) blocks at env validation before
    # reaching model construction, so it can't discriminate pre- vs.
    # post-fix behavior as an automated test today — see
    # childProcessJobData.schema.unit.test.ts for the payload-contract
    # half of this (modelParams optional, sim/judge required, parses).
    # This scenario's real-spawn proof is exercised manually in the
    # post-fix verification run, per dev/docs/TESTING_PHILOSOPHY.md's
    # "run scenario tests end-to-end locally" guidance.

  @unit
  Scenario: A job payload missing every model params field fails at schema parse
    Given a job payload with no adapter, simulator, or judge model params at all
    When the child process parses the job payload
    Then parsing fails with a named schema error

  @unit
  Scenario: An older job payload shape still parses and runs
    Given a frozen job payload in the pre-split shape, carrying only the single adapter-role model params
    When the child process parses the job payload
    Then parsing succeeds
    And the simulator and judge fall back to the adapter-role model params
