# The ledger is seeded once from _prisma_migrations and goose_db_version, and its seeded rows are
# re-read every run: an installation may move outside the ledger with an image older than it.

Feature: Seeded ledger rows follow the tools' records
  As an operator of a LangWatch installation on any release
  I want the upgrade to see where my installation is now
  So that it rolls through every step from there

  @unit
  Scenario: A read-only plan reads seeded rows as the tools record them now
    Given a ledger whose seeded row is pending while the tools record it applied
    When the plan reads the ledger
    Then the seeded row reads as applied
    And a row the runner wrote itself keeps its status
