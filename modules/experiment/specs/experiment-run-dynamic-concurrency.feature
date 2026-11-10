Feature: An experiment run's default concurrency shares a cell budget between active runs

  A run takes its concurrency from the run API request or the workbench setting.
  When neither names one, the server picks a default: the project's cell budget
  (EVAL_V3_PROJECT_CELL_BUDGET, 24 when unset) split between the runs active in
  the project, the new run included, and capped by the same split of
  EVAL_V3_GLOBAL_CELL_BUDGET across every project when that is set. The result is
  never below 1 or above 24. It is computed once when the run starts and does not
  change while the run is in flight. The run is claimed active in the same atomic step
  that reads the others, pinned or not, so runs started together each see the ones
  claimed before them. The budget is soft: each new run gets the budget
  divided by the active runs plus itself, runs keep the value they started with, so
  the cells in flight can exceed the budget; the group queue's per-project cap limits
  dispatch. When the active runs cannot be read, the default is EVAL_V3_CONCURRENCY.

  Rollout: API, SDK and CI runs that send no concurrency get the dynamic default for
  every experiment, old or new; the API path never reads the saved workbench setting.
  Workbench runs of existing experiments keep their saved concurrency (10, saved by
  the old default) until someone picks Auto; new experiments start on Auto. There is
  no migration: a picked 10 and a defaulted 10 cannot be told apart.

  @unit
  Scenario: An idle project gets the full project budget, capped at 24
    Given a project cell budget of 40 and no other run active
    When the run's default concurrency is computed
    Then the run gets concurrency 24

  @unit
  Scenario: A second active run in the project halves the default
    Given a project cell budget of 20 and one other run active in the project
    When the run's default concurrency is computed
    Then the run gets concurrency 10

  @unit
  Scenario: The default concurrency is never below 1
    Given a project cell budget of 4 and nine other runs active in the project
    When the run's default concurrency is computed
    Then the run gets concurrency 1

  @unit
  Scenario: The global budget limits the default when it is tighter
    Given a project cell budget of 20 with no other run in the project
    And a global cell budget of 30 with two other runs active across projects
    When the run's default concurrency is computed
    Then the run gets concurrency 10

  @integration
  Scenario: Runs keep their start value, so the cells in flight can exceed the soft budget
    Given a project cell budget of 24 and no run active
    When three runs start one after another without a concurrency, each still active
    Then they get concurrency 24, 12 and 8
    And 44 cells are in flight, more than the budget of 24, which is expected

  @integration
  Scenario: Runs resolved at the same moment each see the ones claimed before them
    Given a project cell budget of 24 and no run active
    When three runs resolve their default concurrency at the same moment
    Then between them they get concurrency 24, 12 and 8

  @integration
  Scenario: A concurrency named by the request wins over the dynamic default
    Given a project cell budget of 20 and no other run active
    When a run is started with concurrency 3
    Then the run gets concurrency 3
    And it counts as active for the next run, which gets concurrency 10

  @unit
  Scenario: A deployment that names no project budget shares a budget of 24
    Given a deployment that sets no EVAL_V3_PROJECT_CELL_BUDGET
    When its configuration is read
    Then the project cell budget is 24
    And no global budget is set

  @integration
  Scenario: A failed read of the active runs falls back to EVAL_V3_CONCURRENCY
    Given a project cell budget of 20 and EVAL_V3_CONCURRENCY of 7
    And the active runs cannot be read
    When a run is started without a concurrency
    Then the run gets concurrency 7
    And a warning is logged

  @integration
  Scenario: An expired activity entry stops counting
    Given a project cell budget of 20
    And a run that started longer ago than the activity window and never completed
    When a run is started without a concurrency
    Then the run gets concurrency 20

  @integration
  Scenario: A completed run stops counting
    Given a project cell budget of 20 and a run that started and then completed
    When a run is started without a concurrency
    Then the run gets concurrency 20

  @integration
  Scenario: The active runs are shared through the deployment's Redis
    Given two replicas over one Redis
    When one replica records a run as active
    Then the other counts it in the project and across projects

  @integration
  Scenario: The concurrency the default chose is recorded and returned by the run poll
    Given a project cell budget of 16 and one other run active in the project
    When a run is started through the API without a concurrency
    Then the run is planned with concurrency 8
    And the start answer and the run poll both carry concurrency 8

  @integration
  Scenario: A workbench run on Auto names no concurrency, so the dynamic default applies
    Given a new experiment in the workbench, whose concurrency shows "Auto"
    When I run it
    Then the run request names no concurrency
    And the experiment saves no concurrency

  @integration
  Scenario: A workbench run with a picked concurrency sends it
    Given an experiment in the workbench
    When I pick a concurrency of 4 in the run options and run it
    Then the run request names concurrency 4
    And the experiment saves concurrency 4

  @integration
  Scenario: Auto can be picked again after choosing a concurrency
    Given an experiment in the workbench with a concurrency of 4
    When I pick "Auto" in the run options
    Then the concurrency shows "Auto"
    And the run request names no concurrency
