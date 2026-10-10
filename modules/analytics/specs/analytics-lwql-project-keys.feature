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

  @unit
  Scenario: Each worker boot fills the key-map rows a project lacks
    Given a project was stored without the project-created fact, as the dev seed stores one
    When a worker boots and the reconvergence watch probes for the first time
    Then the fill runs once and writes the project's missing row
    And a failed fill is logged and the probe still runs
