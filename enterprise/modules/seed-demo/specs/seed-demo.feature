Feature: Demo organization seeding
  The demo instance seeds its allowlisted demo organization once a day, and an
  operator can run the same seeding once through the tasks role. Main ran it
  from an external CronJob against /api/cron/seed_demo; the module's own
  scheduled process replaces that route.

  @unit
  Scenario: An unset allowlist refuses the run by name
    Given DEMO_ORG_IDS is not set
    When a seed run is asked for
    Then it refuses, naming DEMO_ORG_IDS

  @unit
  Scenario: A malformed allowlist entry is refused
    Given DEMO_ORG_IDS names an id with characters outside the id pattern
    When a seed run is asked for
    Then it refuses, naming the malformed id

  @unit
  Scenario: An organization outside the allowlist is refused
    Given DEMO_ORG_IDS names one demo organization
    When a seed run targets a different organization
    Then it refuses before reading anything

  @unit
  Scenario: A deployment with no allowlist seeds nothing on its daily wake
    Given DEMO_ORG_IDS is not set
    When the daily seed process wakes
    Then it reads nothing and succeeds

  @unit
  Scenario: A demo organization missing its slug fails the identity check
    Given the allowlisted organization has a name but no slug
    When its identity is verified
    Then the action fails, naming the missing slug

  @unit
  Scenario: The seed task refuses an argument it does not know
    When the seed-demo task is run with an unknown flag
    Then it refuses, naming the flag
