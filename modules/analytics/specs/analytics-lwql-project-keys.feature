Feature: A deploy fills LangWatchQL's key map with every project's key

  The query door resolves a key to its project through the key map. Project
  creation writes a project's row inline; the background upgrade step
  "analytics:fill-lwql-project-keys" fills the rows older projects lack. The
  deploy task provisions the access model only and reads no project.

  @unit
  Scenario: The fill step writes each missing row and reports blank keys
    Given the project module pages three projects, one of them with an empty key
    When the step "analytics:fill-lwql-project-keys" runs
    Then the key map gains a row for each of the two keyed projects
    And the report counts one blank key

  @unit
  Scenario: A rerun of the fill step writes nothing new
    Given the step has filled the key map
    When it runs again
    Then it inserts no row

  @unit
  Scenario: A dry run of the fill step writes nothing
    Given the key map lacks two projects' rows
    When the step runs as a dry run
    Then it reports two rows to insert and writes none

  # The worker's reconvergence check is the safety net under the project-created
  # subscriber. A fill reads every project, so it runs once a day, not every 5 minutes,
  # and right after a converge that repaired the key map. A failed fill fails its check, and the
  # outbox delivers that check again, 5 minutes later and doubling to every 2 hours, until a fill
  # succeeds or the retries end before the next day's ask. A redelivered check only fills.
  @unit
  Scenario: The reconvergence check fills the key-map rows a project lacks
    Given a project was stored without the project-created fact, as the dev seed stores one
    When the first reconvergence check runs, the first a day after the last ask, or one whose converge repaired a missing key map, even where another object failed
    Then the fill runs and writes the project's missing row
    And no fill runs while the key map is still missing
    And a failed fill is logged, the check still probes, and the check is delivered again with backoff until a fill succeeds, for less than a day
    And a check delivered again runs only the fill, leaving the converge and the probe to the next check
    And after a fill succeeds, no other fill runs until a day after the ask
