Feature: Experiment service boundary

  @unit
  Scenario: Required reads throw on absence
    Given no active experiment exists for the project and id
    When the Experiment service reads it
    Then ExperimentNotFoundError is thrown

  @unit
  Scenario: Slugs remain unique inside a project
    Given an active experiment already uses a slug
    When another experiment is saved with that requested slug
    Then the service allocates the next numeric slug

  @unit
  Scenario: Archived experiments cannot be resurrected
    Given an experiment is archived
    When a stale client saves the same id
    Then ExperimentNotFoundError is thrown

  @unit
  Scenario: Archive does not cross persistence boundaries
    Given an experiment links a workflow and monitor
    When the Experiment service archives it
    Then only Experiment persistence is changed
    And the transport composes WorkflowService and MonitorService cleanup

  @unit
  Scenario: DSPy steps use the Experiment service
    Given a DSPy optimiser reports a step for an experiment run
    When the step is written and read
    Then the Experiment service validates the Zod 4 value
    And uses its private ClickHouse repository

  Scenario: Batch-result presentation remains controlled and portable
    Given app transport has loaded experiment run values
    When it renders batch results
    Then Experiment web preserves controlled result tables, comparisons, and CSV
    And the app keeps routing, polling, feature gates, drawers, and named rendering actions

  # ── The SDK's create-or-take door: POST /api/experiment/init ─────────
  # Every refusal below is a body an SDK parses, so the shape is the
  # contract, not only the status.

  @unimplemented
  # The credential port is the process's, and the composition that binds it is
  # not landed yet; this is bound where that port is composed.
  Scenario: A create-or-take call with no credential is refused before the body is read
    Given a request to the experiment create-or-take door carrying no project key
    When the door answers
    Then it refuses at 401
    And the body carries a message naming the headers a token may be sent in
    And nothing is read from the experiment store

  @unimplemented
  # As above: the ceiling is enforced by the process's credential port.
  Scenario: A key without permission to manage experiments is refused as sent
    Given a project key that may not manage experiments
    When it calls the experiment create-or-take door
    Then the door answers the ceiling refusal exactly as the credential port sent it
    And nothing is read from the experiment store

  @unit
  Scenario: A body that is not valid JSON gets the door's own bare sentence
    Given a request carrying a body that is not valid JSON
    When the experiment create-or-take door answers
    Then it refuses at 400 with a message field and no validation report

  @unit
  Scenario: A body naming neither identifier is refused with the validation sentence
    Given a request naming neither an experiment slug nor an experiment id
    When the experiment create-or-take door answers
    Then it refuses at 400 with an error field carrying the schema's own sentence
    And nothing is created

  @unit
  Scenario: A plan whose experiment limit is reached is refused with the limit in the body
    Given a project whose plan already holds its maximum experiments
    When it calls the experiment create-or-take door with a free slug
    Then it refuses at 403
    And the body carries the error code, the limit type, the current count and the maximum

  @unit
  Scenario: A free slug creates the experiment and answers the app path
    Given a project key that may manage experiments and a free slug
    When it calls the experiment create-or-take door
    Then the experiment is created
    And the body carries its slug and the app path built from the project's slug
