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
    because a person archived it. And the throwaway suite `langwatch scenario
    run` creates, which carries the label `cli-ephemeral` and is archived as
    soon as the run is queued: joining one attaches a person's run to a plan
    that is about to disappear from every list.

    Two rules follow, and both were bugs in the prototype:

      - replacing the config must never rename the plan, or a plan whose name
        was only ever suggested renames itself and stops answering to the name
        the caller just resolved it by;
      - the plan id and the plan slug must never be derived from the config.
        Two plans may share a config and differ only by name, so a
        config-derived key collides. The slug is derived from the name, with
        the numeric-suffix retry every other suite slug uses.

    Scope modes here are the app's own: `all`, `folders`, `labels` and `cases`.

  # --- Resolving by name ---

  @integration
  Scenario: A run whose name matches no plan creates one
    Given a project with no run plan named "Refunds prod-agent"
    When a run is started under the name "Refunds prod-agent"
    Then a run plan named "Refunds prod-agent" is created
    And it carries the scope and targets the run was started with
    And the run belongs to that plan

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
  Scenario: A folder-kind suite does not answer to a run plan name
    Given a suite of kind folder named "Refunds"
    When a run is started under the plan name "Refunds"
    Then a run plan of kind custom named "Refunds" is created
    And the folder is unchanged

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
  Scenario: A scope naming some but not all suites stays a folders scope
    Given a project holding three suites
    When a scope naming two of them is normalised
    Then it stays a folders scope naming those two

  @unit
  Scenario: A folders scope naming no suite is not treated as everything
    Given a project holding two suites
    When a scope naming no suite is normalised
    Then it stays a folders scope naming none

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

  @integration
  Scenario: A run started under an empty name is refused
    Given a project with scenarios and one target
    When a run is started under a name of only spaces
    Then the run is refused with a validation error
    And no plan is created
