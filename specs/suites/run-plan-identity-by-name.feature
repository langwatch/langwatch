Feature: A run plan is identified by its name
  As a person who runs test scenarios
  I want the run name to decide which plan a run joins
  So that keeping the suggested name lands where I expect and typing a new one forks a plan

  Background: name in, plan out.
    A run plan is a name plus a config: what runs (the scope), the targets, the
    repeat count and the simulation models. When a run starts, the name decides
    the plan:

      - the name matches a non-archived run plan of this project, compared
        trimmed and without case: the run joins that plan and the plan's config
        is replaced with what the caller sent;
      - nothing matches: a plan is created with that name and that config.

    Two kinds of row are skipped when the name is matched. An archived plan,
    because a person archived it. And the throwaway rows written by older
    CLIs, which carry the label `cli-ephemeral` and are archived as soon as
    the run is queued: joining one attaches a person's run to a plan that is
    about to disappear from every list.

    A name is optional. A caller that sends none gets one derived from what
    the run covers and what it runs against, which is the same name the run
    dialog suggests, so a run started from the command line and one started
    from the dialog land on one plan.

    Matching a name and answering it are one step. Runs of a name no plan
    holds yet arrive together, because the REST API, the CLI, the MCP server
    and the run dialog derive the same name for the same scope and targets.
    They are serialized per project and name, so the first of them creates the
    plan and the rest join it.

    Two rules follow, and both were bugs in the prototype:

      - replacing the config must never rename the plan, or a plan whose name
        was only ever suggested renames itself and stops answering to the name
        the caller just resolved it by;
      - the plan id and the plan slug must never be derived from the config.
        Two plans may share a config and differ only by name, so a
        config-derived key collides. The slug is derived from the name, with
        the numeric-suffix retry every other suite slug uses.

    Scope modes here are the app's own: `all`, `test suites`, `labels` and `scenarios`.

  # --- Resolving by name ---

  @integration
  Scenario: A run whose name matches no plan creates one
    Given a project with no run plan named "Refunds prod-agent"
    When a run is started under the name "Refunds prod-agent"
    Then a run plan named "Refunds prod-agent" is created
    And it carries the scope and targets the run was started with
    And the run belongs to that plan

  @integration
  Scenario: Concurrent first runs of one name create one plan
    Given a project with no run plan named "Refunds prod-agent"
    When four runs are started together under the name "Refunds prod-agent"
    Then exactly one run plan named "Refunds prod-agent" exists
    And one of the runs reports that it created the plan
    And every one of the four runs belongs to that plan

  @integration
  Scenario: A run whose name matches a plan joins it and replaces its config
    Given a run plan "Nightly" covering the suite "Refunds" against "dev-agent"
    When a run is started under the name "Nightly" covering every scenario against "prod-agent"
    Then no second plan is created
    And "Nightly" now covers every scenario against "prod-agent"
    And the run belongs to "Nightly"

  @integration
  Scenario: The name is matched trimmed and without regard to case
    Given a run plan named "Nightly"
    When a run is started under the name "  nightly  "
    Then the run joins the existing "Nightly" plan
    And no second plan is created
    And the plan is still spelled "Nightly"

  @integration
  Scenario: An archived plan does not answer to its name
    Given an archived run plan named "Nightly"
    When a run is started under the name "Nightly"
    Then a new run plan named "Nightly" is created
    And the archived plan is left archived

  @integration
  Scenario: The command line's throwaway suite does not answer to its name
    Given a suite labelled "cli-ephemeral" named "CLI run"
    When a run is started under the name "CLI run"
    Then a new run plan named "CLI run" is created
    And the throwaway suite is left alone

  @integration
  Scenario: A test suite does not answer to a run plan name
    Given a suite of kind test suite named "Refunds"
    When a run is started under the plan name "Refunds"
    Then a run plan of kind custom named "Refunds" is created
    And the test suite is unchanged

  # --- A run that names no plan ---

  @integration
  Scenario: A run started with no name is named after its scope and targets
    Given a project holding the test suites "Refunds" and "Checkout"
    When a run of "Refunds" against two agents is started with no name
    Then a run plan named "Refunds <agent> vs <agent>" is created
    And the agents are named in the order the plan stores them
    And a second run with no name joins that same plan

  # --- A run of one scenario is an ordinary plan ---

  @integration
  Scenario: Two runs of one scenario against one agent stack on one plan
    Given a scenario "Angry refund request" and an agent "prod-agent"
    When it is run twice under the name "Angry refund request prod-agent"
    Then only one run plan of that name exists
    And it covers that one scenario
    And both runs belong to it as two separate runs

  @integration
  Scenario: Running one scenario against another agent creates a second plan
    Given a scenario "Angry refund request" run under "Angry refund request prod-agent"
    When it is run under the name "Angry refund request dev-agent"
    Then two run plans exist
    And each covers that one scenario against its own agent

  # --- The rename trap ---

  @integration
  Scenario: Replacing a plan's config does not rename the plan
    Given a run plan named "Nightly" covering the suite "Refunds"
    When a run is started under the name "Nightly" covering every scenario
    Then the plan is still named "Nightly"
    And it still answers to the name "Nightly" on the next run

  @integration
  Scenario: Replacing a plan's config keeps its slug
    Given a run plan named "Nightly" whose slug is "nightly"
    When a run is started under the name "Nightly" with a different scope
    Then the plan's slug is still "nightly"
    And its run history is still read under that plan

  # --- The collision trap ---

  @integration
  Scenario: Two plans may share a config and differ only by name
    Given a run plan "Nightly" covering every scenario against "prod-agent"
    When a run is started under the name "Release check" covering every scenario against "prod-agent"
    Then two run plans exist
    And each keeps its own scenarios and history

  @integration
  Scenario: A new plan whose name slugifies to a taken slug gets a numbered slug
    Given a suite whose slug is "nightly"
    When a run is started under the name "Nightly"
    Then a new run plan named "Nightly" is created
    And its slug is "nightly-2"

  # --- Exhaustive suites normalise to all ---

  @integration
  Scenario: Naming every suite of the project resolves to the same plan as running everything
    Given a project holding exactly the suites "Default" and "Refunds"
    And a run plan created by running every scenario
    When a run is started under the same name with both suites hand-picked
    Then the plan's scope is "all"
    And no second plan is created

  @unit
  Scenario: A scope naming some but not all suites stays a test suites scope
    Given a project holding three suites
    When a scope naming two of them is normalised
    Then it stays a test suites scope naming those two

  @unit
  Scenario: A test suites scope naming no suite is not treated as everything
    Given a project holding two suites
    When a scope naming no suite is normalised
    Then it stays a test suites scope naming none

  @unit
  Scenario: An archived suite does not have to be named for a scope to be exhaustive
    Given a project holding one active suite and one archived suite
    When a scope naming only the active suite is normalised
    Then it becomes the "all" scope

  # --- The config the plan stores ---

  @unit
  Scenario: Targets are stored in a stable order
    Given a run started against "prod-agent" and then "dev-agent"
    When the plan's config is written
    Then the targets are stored in the same order as a run started against "dev-agent" and then "prod-agent"

  # --- A target is an agent and its parameters ---
  #
  # A target may carry parameter overrides of its own, so one agent can be run
  # against itself on two models. The overrides are part of the target's
  # identity: its key is the reference id alone when it carries none, and the
  # reference id plus a short hash of the overrides when it does. The client
  # never hashes anything of its own; it reads the key the server stamped.

  @unit
  Scenario: A target with no overrides keys as its reference id alone
    Given a target pointing at "prod-agent" with no parameter overrides
    When its key is taken
    Then the key reads "prod-agent"
    And a target with an empty set of overrides keys the same way

  @unit
  Scenario: A target with overrides keys as its reference id and a hash of the overrides
    Given a target pointing at "prod-agent" with the override "model=gpt-5-mini"
    When its key is taken
    Then the key reads "prod-agent" followed by "#" and eight hex characters
    And the same overrides written in another order take the same key
    And a different override value takes a different key

  @unit
  Scenario: A target key splits back into its reference id and its hash
    Given the key of a target with overrides
    When it is split
    Then the reference id and the hash are read back
    And the key of a target with no overrides splits into the reference id and no hash

  @unit
  Scenario: A target's parameters read as a sorted list of pairs
    Given the overrides "seats=12" and "model=gpt-5-mini"
    When they are read as a label
    Then the label reads "model=gpt-5-mini, seats=12"

  @unit
  Scenario: A target is labelled with its parameters only when its agent is repeated
    Given a target named "prod-agent" with the override "model=gpt-5-mini"
    When it is the only target of that agent
    Then its label reads "prod-agent"
    When the same agent appears more than once in the run
    Then its label reads "prod-agent · model=gpt-5-mini"
    And a repeated agent with no overrides still reads "prod-agent"

  @unit
  Scenario: The same agent twice with different parameters is two targets
    Given a run against "prod-agent" and against "prod-agent" with the override "model=gpt-5-mini"
    When the targets are sorted for storage
    Then both are kept
    And they are sorted by type, reference id and parameters, read as "type:referenceId|k=v,k2=v2", so the order is the same on every run and the same one the run dialog shows

  @integration
  Scenario: Two identical targets are refused
    Given a project with one scenario and the agent "prod-agent"
    When a run is started against "prod-agent" twice with the same overrides
    Then the run is refused with a validation error naming the targets field
    And no run plan of that name exists
    And nothing is scheduled

  @integration
  Scenario: A run named by the server labels a repeated agent with its parameters
    Given a project holding the test suite "Refunds" and the agent "prod-agent"
    When a run of "Refunds" is started with no name against "prod-agent" and against "prod-agent" with the override "model=gpt-5-mini"
    Then a run plan named "Refunds prod-agent vs prod-agent · model=gpt-5-mini" is created
    And the labels follow the stored order of the targets
    And a second run with no name joins that same plan

  @integration
  Scenario: A run started under an empty name is refused
    Given a project with scenarios and one target
    When a run is started under a name of only spaces
    Then the run is refused with a validation error
    And no plan is created

  # --- A refused run leaves no plan ---
  #
  # A run is resolved in full before its plan row is written: the scenarios it
  # covers, the targets it reaches, and the parameter values each scenario runs
  # with. Every check that can refuse a run reads the config the caller sent,
  # never a stored row, so the plan is written only once the run holds up.
  #
  # Both halves matter. A refused run that created a plan leaves a person
  # reading a plan they never started, with no run under it and nothing saying
  # why. A refused run that matched an existing plan would have replaced that
  # plan's stored configuration on the way to being refused, so the plan would
  # then describe a run that never happened.

  @integration
  Scenario: A run refused for a missing secret value creates no plan
    Given a scenario that declares a secret run parameter
    When a run is started under a new name with no value for that secret
    Then the run is refused with the code "scenario_secret_parameter_missing"
    And no run plan of that name exists
    And nothing is scheduled

  @integration
  Scenario: A run refused for a missing secret value leaves the plan it names unchanged
    Given a run plan "Nightly" covering one scenario against "dev-agent"
    And a second scenario that declares a secret run parameter
    When a run is started under the name "Nightly" covering the second scenario with no value for that secret
    Then the run is refused
    And "Nightly" still covers the first scenario against "dev-agent"
    And nothing is scheduled

  @integration
  Scenario: A run refused for naming no target creates no plan
    Given a project with one scenario
    When a run is started under a new name against no target
    Then the run is refused with the code "suite_targets_required"
    And no run plan of that name exists

  @integration
  Scenario: A run refused for covering no scenario creates no plan
    Given a project where no scenario carries the label "checkout"
    When a run is started under a new name scoped to that label
    Then the run is refused with the code "suite_scope_empty"
    And no run plan of that name exists

  @integration
  Scenario: A run that supplies the secret value creates its plan and starts
    Given a scenario that declares a secret run parameter
    When a run is started under a new name with a value for that secret
    Then a run plan of that name is created
    And the run is scheduled
