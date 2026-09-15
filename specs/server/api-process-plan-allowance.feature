Feature: The interactive process enforces the plan's monthly allowance at its ingest doors

  A plan states how much telemetry an organization may send in a month, and the
  only place that number can be held to is the door the telemetry arrives at.
  This process serves two of them — the OTLP receiver at `/api/otel/v1/traces`
  and the SDK collector at `/api/collector` — and until now neither read the
  allowance at all, so every plan's monthly cap was a number on a screen that
  nothing enforced.

  Enforcement is composed from what this process already holds: the SAME plan
  provider the usage panel and every allowance banner read, the SAME ClickHouse
  the rollups are counted in, and the SAME guarded client every other row is
  read on. Nothing new is opened.

  Two rules matter more than the cap itself. A refusal must be TERMINAL — an
  OTel SDK retries a 429 until its elapsed-time budget runs out, so a plan limit
  answered that way turns one rejection into an unbounded loop against a
  customer who cannot succeed until they upgrade. And a meter that cannot READ
  must never refuse: telemetry a customer already paid to produce must not be
  dropped because our own directory or rollup is down.

  Background:
    Given an interactive process that opened its own database and ClickHouse

  Rule: An organization is measured against the plan it actually resolves to

    @unit
    Scenario: An organization over its plan's allowance is refused by name
      Given a free organization that has sent more events this month than its plan allows
      When the allowance is checked for one of its teams
      Then it is refused
      And the refusal names the unit it is metered in and the limit it reached
      And it names where to raise that limit

    @unit
    Scenario: An organization inside its allowance is not refused
      Given a free organization well inside its monthly event allowance
      When the allowance is checked for one of its teams
      Then it is not refused

    @unit
    Scenario: A trace-metered organization is counted on each project's own endpoint
      Given a paying organization whose plan meters it in traces
      When the allowance is checked for one of its teams
      Then each of its projects is counted on that project's own endpoint
      And the volume is measured against the paid plan's allowance, not the free one

    @unit
    Scenario: A team that resolves to no organization is not metered against nobody's plan
      Given a team no organization owns
      When the allowance is checked for it
      Then the check refuses to answer rather than metering the traffic against nobody's plan

  Rule: A refusal at one door is a refusal at both

    @integration
    Scenario: An export over the plan's allowance is refused terminally
      Given an organization over its monthly allowance
      When it exports telemetry to either ingest door
      Then the export is refused before the batch is parsed
      And the refusal is terminal rather than retryable, so an SDK stops rather than looping
      And nothing is enqueued for processing

    @integration
    Scenario: An export within the plan's allowance is ingested
      Given an organization inside its monthly allowance
      When it exports telemetry
      Then the export is ingested exactly as it is on a process that meters nothing

  Rule: A meter that cannot read never refuses

    @integration
    Scenario: An allowance the process could not read accepts the export
      Given an allowance lookup that fails
      When telemetry is exported
      Then the export is accepted
      And the failure is recorded, so a metering outage reads as a metering outage

    @unit
    Scenario: A deployment with no rollup enforces no allowance
      Given a process that opened no ClickHouse connection
      When the ingest doors are composed
      Then no enforcement is composed at all, rather than one whose every reading is unknown
      And the absence is reported once at boot rather than once per export

    @unit
    Scenario: A deployment holding the rollup enforces the allowance
      Given a process that opened its ClickHouse connection
      When the ingest doors are composed
      Then no missing allowance is reported, because the doors enforce one
