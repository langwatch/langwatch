# The ledger is seeded once from _prisma_migrations and goose_db_version, and its seeded rows are
# re-read every run: an installation may move outside the ledger with an image older than it.

Feature: Seeded ledger rows follow the tools' records
  As an operator of a LangWatch installation below the LTS floor
  I want the upgrade to see where my installation is now
  So that upgrading to the release it names and retrying is admitted

  @integration
  Scenario: A refused install that upgrades to the stop-at release and retries is admitted
    Given an installation below the floor whose first run seeded the ledger and was refused
    And it then upgrades to the stop-at release with an image older than the ledger
    When the upgrade runs again
    Then the seeded rows are re-read from the tools' records
    And the upgrade is admitted and completes

  @unit
  Scenario: A read-only plan reads seeded rows as the tools record them now
    Given a ledger whose seeded row is pending while the tools record it applied
    When the plan reads the ledger
    Then the seeded row reads as applied
    And a row the runner wrote itself keeps its status
