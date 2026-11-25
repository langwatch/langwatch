Feature: Gateway operator tasks

  A one-shot task carries main's trace-destination script over (the behaviour is in
  specs/ai-gateway/governance/trace-destination-backfill-report.feature). It runs in the tasks
  process and reads the gateway's own tables through the gateway's own repositories. Main's
  virtual-key config backfill is retired: its strip migration shipped in 3.19.0, below the
  3.20.1 floor, so no supported installation holds the legacy keys (Alex, 2026-10-09).

  @integration
  Scenario: The gateway offers its operator tasks to the tasks process
    Given the gateway process module installed over memory stores
    When the tasks process lists the tasks the module declared
    Then it lists "trace-destination-report"
    And it does not list "virtual-key-config-backfill"

  @integration
  Scenario: The operator tasks run over the gateway's own stores
    Given keys, projects and organizations held by the gateway's stores
    When the "trace-destination-report" task reads them
    Then it classifies every key by how its destination resolves
