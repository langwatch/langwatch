Feature: Attach a comparison via the CLI
  As a user with an existing experiment
  I want to attach a comparison judge from the langwatch CLI
  So that I can set up and run comparisons without opening the Workbench UI

  # A comparison is an evaluator target (langevals/select_best_compare) whose
  # `comparison.variants` list references two or more other target ids in the
  # same experiment. Until now the only way to build one was the Workbench UI,
  # because the only write path for an experiment's targets/evaluators was a
  # session-authenticated mutation with no API-key equivalent.
  #
  # `langwatch experiment add-comparison <slug>` closes that gap. It must work
  # against an experiment that already exists and already has targets, not
  # just a freshly-scaffolded one — attaching a comparison to variants a user
  # already built in the UI is the common case, not the exception.

  Background:
    Given an experiment "quality-check" exists with an active dataset

  @unit
  Scenario: Attach a comparison to two targets that already exist
    Given the experiment already has prompt targets "draft-v1" and "draft-v2"
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1 --variant prompt:draft-v2 --golden-field expected_output"
    Then a single new comparison target is added to the experiment
    And the comparison's variants reference the existing "draft-v1" and "draft-v2" targets
    And no duplicate "draft-v1" or "draft-v2" target is created

  @unit
  Scenario: Attach a comparison creating missing variant targets inline
    Given the experiment has no targets yet
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1 --variant agent:agent_123 --golden-field expected_output"
    Then a prompt target for "draft-v1" is created
    And an agent target for "agent_123" is created
    And a comparison target is added referencing both new targets
    And running the experiment afterward evaluates the comparison successfully

  @unit
  Scenario: A prompt variant reuses its existing target instead of duplicating it
    Given the experiment already has a prompt target for prompt "draft-v1"
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1 --variant prompt:draft-v2"
    Then the comparison reuses the existing "draft-v1" target
    And only one new target is created, for "draft-v2"

  @unit
  Scenario: Rejects fewer than two variants
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1"
    Then the command fails
    And the error explains at least two variants are required

  @unit
  Scenario: Rejects a variant that is itself a comparison
    Given the experiment already has a comparison target "verdict"
    When I run "langwatch experiment add-comparison quality-check --variant target:verdict --variant prompt:draft-v2"
    Then the command fails
    And the error explains a comparison cannot be compared

  @unit
  Scenario: Unknown existing-target reference lists the current targets
    Given the experiment has targets "draft-v1" and "draft-v2"
    When I run "langwatch experiment add-comparison quality-check --variant target:does-not-exist --variant prompt:draft-v2"
    Then the command fails
    And the error lists the current target ids and types so I can pick a valid one

  @unit
  Scenario: Rejects a variant whose input cannot be mapped to the dataset
    Given a prompt "unrelated-prompt" whose only input has no matching dataset column
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1 --variant prompt:unrelated-prompt"
    Then the command fails
    And the error explains which input is unmapped
    And no partially-built comparison target is persisted

  @unit
  Scenario: Rejects a request without the evaluations:manage permission
    Given my API key does not have the "evaluations:manage" permission
    When I run "langwatch experiment add-comparison quality-check --variant prompt:draft-v1 --variant prompt:draft-v2"
    Then the command fails with a permission error

  @integration
  Scenario: A CLI-built comparison runs identically to a UI-built one
    Given I attach a comparison via the CLI to two prompt variants with golden answers
    When I run "langwatch experiment run quality-check --wait"
    Then the comparison evaluates every row
    And each row's winner and reasoning are available in the run results
