Feature: The results atom
  As a person reading the Results tab
  I want every number on the page to come from one flat list of scenario runs
  So that a filter or a grouping moves every number together

  Background: one atom is one scenario, one target, one run.
    The Results tab groups the same data four ways and filters it five ways.
    To make that possible the server reads results as a flat list of atoms.
    An atom is one row of the scenario run table: one scenario, run once
    against one target, inside one run.

    An atom carries the plan it belongs to, the run and the number of that run,
    when it started, what started it, the note of the run, the scenario with
    its test suite and its labels, the target and a stable key for that target,
    whether it passed, and what it cost.

    Two reads serve the tab. The overview aggregates atoms in the database and
    returns the totals and the group rows. The atom list returns the atoms
    themselves, one page at a time. Both take the same filter, so the two can
    never disagree about what is in scope.

  # --- The shape of an atom ---

  @integration
  Scenario: An atom names its plan, its run and its scenario
    Given a run of one scenario against one target
    When the atoms of the project are read
    Then one atom is returned
    And it carries the id and the name of the run plan
    And it carries the id of the run and the number of that run
    And it carries the id and the name of the scenario

  @integration
  Scenario: A run pushed from code folds under its set and its name
    Given two runs pushed from code named "List agents", each carrying an id the SDK made up
    And both belong to the set "german"
    When the atoms are read
    Then both fold under the key "german-list-agents"
    And the same name pushed in the set "english" folds under "english-list-agents"

  @integration
  Scenario: A run started on the platform folds under its scenario id
    Given a run started on the platform against a stored scenario
    When the atoms are read
    Then it folds under that scenario's id, whatever its name

  @integration
  Scenario: A run pushed from code with no name keeps its id
    Given a run pushed from code that carries no name
    When the atoms are read
    Then it folds under its own id

  @integration
  Scenario: An atom carries the name its run was given
    Given a run pushed from code named "List agents"
    When the atoms are read
    Then the atom reads the name "List agents"

  @integration
  Scenario: A filter on scenarios keeps a scenario that ran from code by its key
    Given runs pushed from code named "List agents" and "List prompts" in the set "default"
    When the filter names "default-list-agents"
    Then only the runs of "List agents" remain

  @integration
  Scenario: The scenarios that ran from code are listed for the filter
    Given runs pushed from code named "List agents" and "List prompts", and a run started on the platform
    When the scenarios that ran from code are read
    Then "List agents" and "List prompts" are listed under their keys
    And the platform run is not

  @unit
  Scenario: An atom names its scenario and leaves the test suite and the labels out
    Given a run of a scenario that sits in a suite and carries two labels
    When the atom of that run is read
    Then it carries the id of the scenario
    And it carries neither the test suite nor the labels

    Labels and test suite membership live in Postgres and the run row holds
    neither, so joining them onto every atom would put a second store in the
    hot path of a read that returns one row per scenario run. They are filter
    inputs instead, resolved to scenario ids before the query runs, and the
    page names a scenario from the id the atom already carries.

  @integration
  Scenario: An atom carries the target the run was pointed at
    Given a run pointed at a prompt target
    When the atom is read
    Then it carries the type and the reference id of that target
    And its target key joins the two, so two runs of the same target group together

  @integration
  Scenario: A run pushed from code carries no target
    Given a run recorded by the SDK with no platform target
    When the atom is read
    Then its target is empty
    And its target key reads "unknown", so the atom still groups by target

  @integration
  Scenario: A run that reports its agents names its target by the agent it tested
    Given a run pushed from code that reports the agent "AcmeSupportAgent",
      a user simulator and a judge
    When the atom is read
    Then its target key reads "code:acmesupportagent"
    And it carries the target name "AcmeSupportAgent"
    And the user simulator and the judge are left out, since neither is what
      the run tests

  @integration
  Scenario: Two runs of one agent name fold under one target
    Given two runs pushed from code, both reporting the agent "AcmeSupportAgent"
    When the overview is read grouped by target
    Then one group is returned
    And it reads "AcmeSupportAgent"

  @integration
  Scenario: A run that reports no agent stays under the unknown target
    Given a run pushed from code that reports no agent
    When the atom is read
    Then its target key reads "unknown"
    And it carries no target name

  @integration
  Scenario: A run started on the platform keeps its platform target
    Given a run started on the platform that also reports the agent "AcmeSupportAgent"
    When the atom is read
    Then its target key reads the reference id of the platform target

    The platform runs its own scenarios through the same SDK, so such a run
    can report agents as well. The stamped reference id always wins, or a run
    of a stored agent would move to another target as soon as the SDK reports
    what it wired in.

  @integration
  Scenario: The targets named by runs from code are listed for the filter
    Given runs pushed from code naming "AcmeSupportAgent" and "AcmeBillingAgent",
      a run that named no agent, and a run started on the platform
    When the targets that ran from code are read
    Then both agents are listed under their keys, in name order
    And the run that named no agent is not listed
    And the platform run is not
    And no more targets are returned than the cap allows

  @integration
  Scenario: One run against two targets gives one atom per target
    Given a run of two scenarios against two targets
    When the atoms are read
    Then four atoms are returned
    And they all carry the same run id

  @integration
  Scenario: The number of a run counts the runs of its plan, oldest first
    Given a plan with three runs inside the period
    When the atoms are read
    Then the atoms of the oldest run carry the number 1
    And the atoms of the newest run carry the number 3
    And every atom of one run carries the same number

  @integration
  Scenario: A run started on the platform reads as started in the app
    Given a run started from the run dialog
    When its atom is read
    Then its trigger reads "app"

  @integration
  Scenario: A run pushed from code reads as started from code
    Given a run recorded by the SDK
    When its atom is read
    Then its trigger reads "code"

  @integration
  Scenario: An atom carries the note of its run
    Given a run started with the note "stricter judge"
    When its atoms are read
    Then every atom of that run carries that note

  # --- Cost ---

  @integration
  Scenario: An atom takes its cost from the stored total of its run
    Given a scenario run whose cost was computed
    When its atom is read
    Then its cost is the stored total
    And the source of that cost reads "run"

  @integration
  Scenario: An atom with no stored total takes its cost from its traces
    Given a scenario run with per trace costs but no stored total
    When its atom is read
    Then its cost is the sum of the costs of its traces
    And the source of that cost reads "traces"

  @integration
  Scenario: A trace listed twice on a run is counted once
    Given a scenario run that lists the same trace id twice
    When the cost of its atom is read from its traces
    Then the cost of that trace is counted once

  @integration
  Scenario: A run that spent nothing reads as zero, not as unknown
    Given a scenario run whose traces all cost zero
    When its atom is read
    Then its cost reads zero
    And the source of that cost reads "traces"

  @integration
  Scenario: A run whose cost was never measured reads as unknown, not as zero
    Given a scenario run with traces but with no cost recorded for them
    When its atom is read
    Then its cost is empty
    And the source of that cost reads "unknown"

  @integration
  Scenario: A run that started nothing costs nothing
    Given a scenario run that failed before it reached a trace
    When its atom is read
    Then its cost reads zero
    And the source of that cost reads "none"

  @integration
  Scenario: The overview says how many atoms have no known cost
    Given a period holding one run with a cost and one run whose cost is unknown
    When the overview is read
    Then the total cost holds only the known cost
    And the overview reports one atom of unknown cost
    And it reports two atoms in total, so the page can name the boundary

  # --- Filters ---

  @integration
  Scenario: The period keeps out runs outside it
    Given one run inside the period and one run before it
    When the atoms of the period are read
    Then only the atoms of the run inside the period are returned

  @integration
  Scenario: A filter on scenarios keeps only those scenarios
    Given a run of three scenarios
    When the atoms are read for one of them
    Then only the atoms of that scenario are returned

  @integration
  Scenario: A filter on targets keeps only those targets
    Given a run of one scenario against two targets
    When the atoms are read for one target key
    Then only the atom of that target is returned

  @integration
  Scenario: A filter on status keeps only runs of that status
    Given a run in which one scenario passed and one failed
    When the atoms are read for failed runs
    Then only the atom of the failed scenario is returned

  @integration
  Scenario: A filter on labels keeps only scenarios carrying a label
    Given two scenarios, one labelled "checkout"
    When the atoms are read for the label "checkout"
    Then only the atoms of the labelled scenario are returned

  @integration
  Scenario: A filter with an empty list of scenarios returns nothing
    Given a project with runs
    When the atoms are read for an empty list of scenarios
    Then no atom is returned
    And no query is sent to the database

  # --- The overview ---

  @integration
  Scenario: The overview groups by run plan
    Given two plans, each with runs inside the period
    When the overview is read grouped by run plan
    Then one group is returned per plan
    And each group carries the name of its plan
    And each group carries its pass rate, its run count and its scenario count

  @unit
  Scenario: A group of runs pushed from code reads the name its runs carried
    Given a group whose key names no stored scenario
    And its runs carry the name "List agents"
    When the overview is read
    Then the group reads "List agents"

  @integration
  Scenario: The overview groups by scenario
    Given one scenario run by two plans
    When the overview is read grouped by scenario
    Then one group is returned for that scenario
    And its run count counts the runs of both plans

  @integration
  Scenario: The overview groups by target
    Given a run of one scenario against a development target and a production target
    When the overview is read grouped by target
    Then one group is returned per target
    And each group carries the pass rate of that target alone

  @integration
  Scenario: The overview totals move when a filter moves
    Given a period holding a passing run and a failing run
    When the overview is read for failed runs only
    Then the pass rate of the whole period reads zero
    And the totals count only the failed atoms

  @integration
  Scenario: A group carries one trend point per run
    Given a plan with three runs inside the period
    When the overview is read grouped by run plan
    Then the group of that plan carries three trend points
    And they read oldest first
    And each point carries the pass rate of its run

  @integration
  Scenario: A sparkline asks the database only for the points it draws
    Given a plan with more runs inside the period than a sparkline draws
    When the trend of that period is read grouped by run plan
    Then the database returns no more points for that plan than a sparkline draws
    And the points it returns are the most recent runs of the plan

    A plan run twice a day for 30 days holds 60 runs and a sparkline draws 14,
    so trimming after the rows arrive sent 46 rows per plan across the wire to
    be dropped. The Results tab is the default view of the page, so this is the
    common path and not an occasional read.

  @unit
  Scenario: A run plan bar folds a whole run, a scenario bar folds one execution
    Given the run plan grouping and the scenario grouping
    When each names the grain of one sparkline bar
    Then the run plan grouping folds a whole run
    And the scenario and target groupings fold one execution

    A plan row spans many scenarios, so a single scenario's verdict says
    nothing about the plan. A scenario row or a target row already names one
    thing, so each bar is one execution of it.

  # --- Paging the atom list ---

  @integration
  Scenario: The atom list pages and says when more remain
    Given a period holding more atoms than one page holds
    When the first page of atoms is read
    Then the page holds no more atoms than the limit
    And it reports that more remain
    And it returns a cursor

  @integration
  Scenario: The next page carries on where the first stopped
    Given the first page of atoms and its cursor
    When the next page is read with that cursor
    Then it holds the atoms after the last atom of the first page
    And no atom is returned twice

  # --- Reading the correct version ---

  @integration
  Scenario: An atom reads the latest version of its run
    Given a scenario run written once as running and once as passed
    When its atom is read
    Then it reads as passed
    And one atom is returned, not two

  @integration
  Scenario: An archived run is left out
    Given a run that was archived
    When the atoms are read
    Then no atom of that run is returned

  @integration
  Scenario: Atoms never cross a project
    Given two projects holding a scenario run of the same id
    When the atoms of one project are read
    Then only the atom of that project is returned

  @integration
  Scenario: A row that names no scenario is not an atom
    Given a stored run row that carries no scenario id
    When the atoms are read
    Then no atom of that row is returned

    An atom is one scenario, one target, one run. A row that names no
    scenario answers none of those, so it groups under an empty key and
    reads as a row with no name.
