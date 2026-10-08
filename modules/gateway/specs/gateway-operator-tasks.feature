Feature: Gateway operator tasks

  Two one-shot tasks carry main's operator scripts over (the behaviour is in
  specs/ai-gateway/governance/trace-destination-backfill-report.feature and
  virtual-key-config-backfill.feature). They run in the tasks process and read
  the gateway's own tables through the gateway's own repositories.

  @integration
  Scenario: The gateway offers its operator tasks to the tasks process
    Given the gateway process module installed over memory stores
    When the tasks process lists the tasks the module declared
    Then it lists "trace-destination-report" and "virtual-key-config-backfill"

  @integration
  Scenario: The operator tasks run over the gateway's own stores
    Given keys, projects and organizations held by the gateway's stores
    When the "trace-destination-report" task reads them
    Then it classifies every key by how its destination resolves
    When the "virtual-key-config-backfill" task runs with --execute
    Then it mints the routing policy at the key's scopes and strips the legacy keys from the key's config
    And without --execute it leaves the stored key as it was

  @unit
  Scenario: The virtual-key config backfill walks every page of organizations
    Given the organization module lists its ids in pages
    When the "virtual-key-config-backfill" task runs
    Then it follows each page's cursor until none is left
    And it reads the keys of every organization on every page

  @unit
  Scenario: The virtual-key config backfill ends on an empty page of organizations
    Given the organization module lists no organization ids
    When the "virtual-key-config-backfill" task runs
    Then the scan ends after that page and reads no keys
