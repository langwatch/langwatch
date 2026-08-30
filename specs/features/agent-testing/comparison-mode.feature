Feature: Comparison mode
  As a person who wants to know which agent, or which model, does better
  I want one run that goes against several targets
  So that the same scenarios are judged on each and the numbers sit next to each other

  Background: a target is an agent and its parameters.
    A comparison run goes against a list of targets. A target is an agent
    together with the parameter overrides that run of the agent gets, so the
    same agent may appear twice with different parameters: one connection, two
    models.

    In the run dialog, "Compare agents" replaces the "Agent to be tested" and
    the "Parameters" sections with one section, "Compare agents". The section
    holds one row per target: a colour dot, the agent, a parameters line in the
    "name=value, name=value" grammar, and an x. The colour of a row is its
    position, and the same colour marks that target on the run detail.

    A comparison has one layer of parameters: the line of each row. Every row
    starts with the line the Parameters section held, and a new row copies the
    last one, so a person changes the one value that is to differ. The run
    carries no run-level parameters besides the secrets.

    Secret parameters stay run-level and shared across the targets, so a scope
    that declares one shows a single "Secret parameters" block under the rows.

  # --- The rows ---

  @integration
  Scenario: Compare agents replaces the agent and the parameter sections
    Given the run dialog with "dev-agent" chosen and the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the "Agent to be tested" section and the "Parameters" section are gone
    And the "Add parameters" chip is not offered
    And one "Compare agents" section holds two rows
    And each row carries a colour dot in the colour of its position

  @integration
  Scenario: The first row is the agent that was chosen with its parameter line
    Given the run dialog with "dev-agent" chosen and the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the first row holds "dev-agent" and "locale=de"

  @integration
  Scenario: The second row defaults to the next agent with the same parameter line
    Given a project with "dev-agent" and "prod-agent", and "dev-agent" chosen with the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the second row holds "prod-agent" with the parameter line "locale=de"

  @integration
  Scenario: The second row defaults to the same agent when there is no other
    Given a project with one agent, "dev-agent", chosen with the parameter line "locale=de"
    When "Compare agents" is chosen
    Then the second row holds "dev-agent" with the parameter line "locale=de"

  @integration
  Scenario: A row is added as a copy of the last row, up to four
    Given the run dialog in compare mode where the last row holds "prod-agent" and "locale=de"
    When "Add a target to compare" is chosen
    Then a third row holds "prod-agent" with the parameter line "locale=de"
    And the control is gone once there are four rows

  @integration
  Scenario: The hint under the rows says the same agent twice works
    Given the run dialog in compare mode
    Then under the rows it reads "The same agent twice with different parameters works: one connection, two models."

  @integration
  Scenario: Removing a row down to one leaves compare mode with that row as the agent
    Given the run dialog in compare mode with "dev-agent" and "prod-agent"
    When the row of "dev-agent" is removed
    Then the "Agent to be tested" section is back with "prod-agent" chosen

  @integration
  Scenario: Removing the section puts the first row back
    Given the run dialog in compare mode where the first row holds "dev-agent" and "locale=de"
    When "Remove the comparison" is chosen
    Then "dev-agent" is the agent to be tested
    And the "Parameters" section holds "locale=de"

  @unit
  Scenario: A row takes the colour of its place in the sorted target list
    Given rows for "prod-agent" and then for "dev-agent"
    Then the dot of "dev-agent" reads the first colour and "prod-agent" the second
    And each row keeps the colour its column reads on the run detail

  @integration
  Scenario: Two rows with the same agent and the same parameters are refused
    Given the run dialog in compare mode with "dev-agent" twice, both with "model=gpt-5-mini"
    Then it reads "Two targets are the same agent with the same parameters."
    And Run is off

  @integration
  Scenario: The secret parameters of the scope are one shared block
    Given a scope that declares a secret parameter
    When "Compare agents" is chosen
    Then one "Secret parameters" block with that row sits under the rows
    And the run waits for its value

  @integration
  Scenario: A comparison always offers a way to add a shared secret
    Given a scope that declares no parameter at all
    When "Compare agents" is chosen
    Then the "Secret parameters" block still offers "Add secret parameter"

  # --- What the run carries ---

  @integration
  Scenario: Each target carries its own parameters
    Given the run dialog in compare mode with "dev-agent" on "model=gpt-5" and "dev-agent" on "model=gpt-5-mini"
    When Run is chosen
    Then the run carries two targets, each with its own parameters
    And the run carries no run-level parameters

  @integration
  Scenario: A typed default is not an override
    Given a scope that declares "locale" with the default "en"
    When a row is typed "locale=en, model=gpt-5"
    Then the target's overrides are "model=gpt-5" alone
    And a row typed "locale=en" carries no override at all
    And the run and the results read the target the way the server keys it

  @integration
  Scenario: Two rows that differ only by a typed default are one target
    Given a scope that declares "locale" with the default "en"
    And the run dialog in compare mode with "dev-agent" on an empty line and "dev-agent" on "locale=en"
    Then it reads "Two targets are the same agent with the same parameters."
    And Run is off

  @integration
  Scenario: A stored comparison comes back with every target and its parameters
    Given a stored configuration with three targets, each with its own parameters
    When it is picked from the list
    Then the section holds three rows
    And each row holds the parameters of its target

  # --- The name and the footer ---

  @unit
  Scenario: A target of a comparison is named after its agent
    Given a comparison of "dev-agent" and "prod-agent"
    Then the run name reads "<scope> dev-agent vs prod-agent"

  @unit
  Scenario: The same agent twice is named with the parameters that differ
    Given a comparison of "dev-agent" on "locale=de, model=gpt-5" and "dev-agent" on "locale=de, model=gpt-5-mini"
    Then the run name reads "<scope> dev-agent · model=gpt-5 vs dev-agent · model=gpt-5-mini"
    And a value both targets share is not in the name

  @unit
  Scenario: A repeated agent that carries none of the differing parameters keeps its bare name
    Given a comparison of "dev-agent" on "locale=de" and "dev-agent" on "locale=de, plan=pro"
    Then the targets read "dev-agent" and "dev-agent · plan=pro"

  @unit
  Scenario: Targets are sorted by agent and then by parameters
    Given a comparison picked as "prod-agent", then "dev-agent" on "model=b", then "dev-agent" on "model=a"
    Then the targets read "dev-agent · model=a", "dev-agent · model=b", "prod-agent"

  @integration
  Scenario: The footer counts the targets
    Given the run dialog in compare mode with two targets over three scenarios
    Then the Run button reads "Run 3 scenarios × 2 targets"

  # --- The run detail on a comparison run ---
  #
  # A run is a comparison when its scenario runs go against more than one
  # target key. The targets read in their sorted order, and each takes the
  # colour of its position, the same colour its row had in the dialog.

  @integration
  Scenario: A comparison run reads one column per target
    Given a run of two scenarios against "dev-agent" and "prod-agent"
    When the run is opened
    Then the table reads a "Scenario" column, then one column per target, in sorted order
    And each target column carries a dot in the colour of its position
    And no row carries a menu

  @integration
  Scenario: A long target name keeps its own column
    Given a run against two targets whose names carry their environment and parameters
    When the run is opened
    Then every column header reads its whole label
    And no label runs over the column beside it

  @integration
  Scenario: Each target column carries its own summary
    Given a run against "dev-agent" and "prod-agent" where "dev-agent" passed one of two and "prod-agent" passed two of two
    When the run is opened
    Then the "dev-agent" column reads "50%" and the "prod-agent" column reads "100%"
    And the header line carries no summary of its own

  @integration
  Scenario: A cell reads one line per run of its scenario and target
    Given a run against two targets where a scenario ran three times against each
    When the run is opened
    Then the cell of that scenario and target reads three verdicts, each with its time and cost
    And each verdict opens the run drawer of that run

  @integration
  Scenario: A scenario with no run for a target reads not in run
    Given a run against two targets where a scenario ran against only one of them
    When the run is opened
    Then the cell of the other target reads "not in run"

  @integration
  Scenario: A run that is still going keeps its status in the cell
    Given a comparison run where one scenario is still running against one target
    When the run is opened
    Then that cell reads the running status and no time and no cost

  @integration
  Scenario: The charts of a comparison run put the targets next to each other
    Given a comparison run of a plan with two earlier runs of the same targets
    When the run is opened
    Then four charts read between the run settings and the table: "Pass rate", "Total cost", "Average reply latency" and "Pass rate over runs"
    And each chart draws one bar per target, in the colour of the target
    And under a bar the label reads the parameters that differ when the agent repeats, "default" for the target with none, or the agent name when the names differ
    And the full label of the target reads on hover
    And "Pass rate over runs" draws one group per run of the plan, oldest first

  @integration
  Scenario: A single-target run carries no comparison charts
    Given a run against one target
    When the run is opened
    Then no comparison chart reads on the page

  @integration
  Scenario: The grid of a comparison run reads one section per target
    Given a comparison run against "dev-agent" and "prod-agent"
    When the grid view is chosen
    Then one section per target reads a dot and the name of the target above its cards

  @integration
  Scenario: The runs rail reads one rate per target on a comparison run
    Given a comparison run where "dev-agent" passed 62% and "prod-agent" passed 81%
    Then its entry in the runs rail reads "62% vs 81% · 2 targets"
    And each rate reads in its own pass-rate colour
    And the entry carries no "passed" count

  @integration
  Scenario: The run settings of a comparison read one layer of parameters
    Given a run against "dev-agent" and "dev-agent" on "model=gpt-5-mini", both over "locale=de"
    When the run settings are shown
    Then a "Targets" row reads one line per target, with its dot, its name and every parameter it received as chips
    And the line of "dev-agent" reads "locale = de"
    And the line of "dev-agent" on "model=gpt-5-mini" reads "locale = de" and "model = gpt-5-mini"
    And there is no "Parameters" row

  @integration
  Scenario: A single-target run reads as before
    Given a run against one target over "locale=de"
    When the run is opened
    Then the table reads one row per scenario with its verdict, its time and its cost
    And the header line carries the summary of the run
    And the run settings name the target on a "Targets" row
    And the "Parameters" row reads "locale = de"

  @integration
  Scenario: An older run with no target key reads as one column
    Given a run recorded before targets carried a key, against one reference id
    When the run is opened
    Then it reads as a single-target run

  @unit
  Scenario: The repeat count counts the runs of each scenario and target key
    Given a run where a scenario ran once against "dev-agent" and once against "dev-agent" on "model=gpt-5-mini"
    Then the repeat count is one

  @unit
  Scenario: The Parameters row reads the run-level parameters alone
    Given a run whose target carries "model=gpt-5-mini" over the run-level "locale=de"
    Then the parameters of the run settings read "locale=de" alone

  @unit
  Scenario: A value one target overrides is still read from a target that did not
    Given a run where one target overrides "plan" and another target does not
    Then the parameters of the run settings read the "plan" the second target carried
    And the order the runs arrive in does not change what is read

  @unit
  Scenario: Each target of a run reads every parameter it received
    Given a run against "dev-agent" over "locale=de" and "dev-agent" on "model=gpt-5-mini" over "locale=de"
    Then the parameters of "dev-agent" read "locale=de"
    And the parameters of "dev-agent" on "model=gpt-5-mini" read "locale=de" and "model=gpt-5-mini"
    And a name one scenario of the target declares and another does not still reads on its line

  @unit
  Scenario: Runs are grouped by their target key
    Given runs against "dev-agent" and "dev-agent" on "model=gpt-5-mini"
    Then they fold into two groups, one per key
    And a run recorded before targets carried a key folds under its reference id

  @unit
  Scenario: Iterations are counted per scenario and target key
    Given a scenario that ran twice against "dev-agent" on "model=gpt-5-mini" and once against "dev-agent"
    Then the two runs of the variant are numbered one and two
    And the run of the bare target carries no number

  @unit
  Scenario: The targets of a run are ordered and coloured by position
    Given runs against "prod-agent", then "dev-agent" on "model=b", then "dev-agent" on "model=a"
    Then the targets read "dev-agent · model=a", "dev-agent · model=b", "prod-agent"
    And each takes the colour of its position

  @unit
  Scenario: A target that is alone with its agent keeps its bare name
    Given runs against "dev-agent" on "model=gpt-5-mini" and "prod-agent"
    Then the targets read "dev-agent" and "prod-agent"
    And each keeps its parameters

  @unit
  Scenario: The targets of a repeated agent read the parameters that differ
    Given runs against "dev-agent" on "locale=de, model=a" and "dev-agent" on "locale=de, model=b"
    Then the targets read "dev-agent · model=a" and "dev-agent · model=b"

  # --- The results list ---

  @integration
  Scenario: A target group row names its parameters
    Given runs of "prod-agent" and of "prod-agent" on "model=gpt-5-mini" inside the window
    When the list is grouped by target
    Then one row reads "prod-agent" and another reads "prod-agent · model=gpt-5-mini"

  @integration
  Scenario: The Targets cell of a plan names each variant
    Given a plan that ran "prod-agent" against "prod-agent" on "model=gpt-5-mini"
    Then its Targets cell reads "prod-agent vs prod-agent · model=gpt-5-mini"

  @integration
  Scenario: The Target filter offers a parameter variant
    Given a run of "prod-agent" on "model=gpt-5-mini" inside the window
    When the Target filter is opened
    Then it offers "prod-agent · model=gpt-5-mini"
    And choosing it narrows the list to that key
