Feature: The upgrade summary the usage report carries
  One fleet page covers cloud regions and self-hosted installs alike, so every
  install's usage report says where its upgrade stands: the release its ledger
  records, the floor, the installation state, and how many steps failed and
  tenants are held. Counts and our own release names only, never a step's error
  or a tenant. The field is optional, so a sender at any version still lands.

  @unit
  Scenario: The report carries the install's upgrade summary
    Given an install whose upgrade ledger records release "3.21.0" above floor "3.20.1"
    And one step failed on two targets and a migration holds two tenants
    When ops health is read for the report
    Then its upgrade section carries the release, the floor, the state, one failed step, two failed targets and two held tenants
    And it names no step, no error and no tenant

  @unit
  Scenario: An unreadable upgrade ledger is reported as unknown, not as current
    Given an install whose upgrade ledger cannot be read
    When ops health is read for the report
    Then its upgrade section is null, never a zero count

  @unit
  Scenario: A report with or without the upgrade summary is accepted
    Given a report from an install older than the upgrade summary
    And a report from an install that carries it
    When the receiver reads each against the report schema
    Then both are accepted and the upgrade summary is kept where it was sent
