# A contract step never outruns a background step (Alex, 2026-10-09, UPGRADE-FIXES). A contract step
# is a schema step whose SQL carries `-- contract: retired in <release>`. Before the release holding
# one is applied, every unfinished background step shipped in an earlier release runs inline under
# the upgrade, forced and blocking, so a contract never drops data a background step still needs.

Feature: A contract step waits for the background steps shipped before it
  As an operator of a LangWatch installation
  I want a background step that a contract would outrun to finish first
  So that no upgrade drops data a background step has not moved yet

  @unit
  Scenario: An unfinished background step of an earlier release runs inline before a contract release
    Given 3.21.0 and 3.22.0 each ship an unfinished background step
    And 3.23.0 ships a contract step
    When 3.20.1 upgrades to 3.23.0
    Then both background steps run before 3.23.0's schema, and none before 3.21.0's or 3.22.0's

  @unit
  Scenario: A finished background step is not run again before a contract release
    Given the 3.21.0 background step is done
    When 3.20.1 upgrades to 3.23.0
    Then only the 3.22.0 background step runs before 3.23.0's schema

  @unit
  Scenario: A release without a contract step waits for no background step
    Given no planned release ships a contract step
    When the upgrade is planned
    Then no background step runs inline

  @unit
  Scenario: A background step runs before a contract only when an earlier release shipped it
    Given a background step shipped in the contract's own release and one not released yet
    When the upgrade is planned
    Then neither runs before a released contract, and the released one runs before an unreleased contract

  @unit
  Scenario: A schema step is a contract when its SQL carries the retirement note
    Given a Prisma folder and a goose file that drop with the note, and two that only add
    When the image's contract steps are read
    Then only the two that drop are contract steps

  @unit
  Scenario: A background step run before a contract runs even while old writers still serve
    Given a pending background step that waits for old writers, on a process that does not serve
    When the upgrade runs it before a contract step
    Then it runs and is recorded done without asking the serving roster

  @unit
  Scenario: A background step already done is not run again before a contract
    Given a background step a worker already finished
    When the upgrade runs it before a contract step
    Then it is skipped without taking its lease

  @integration
  Scenario: A jump runs the earlier release's unfinished background step before the contract release's schema
    Given 3.20.1 is installed and 3.21.0 ships a background step that waits for old writers
    And 3.22.0 ships a contract step
    When the upgrade jumps to 3.22.0
    Then it applies 3.21.0's schema, runs the background step, then applies 3.22.0's schema

  @integration
  Scenario: A background step the worker finished is not run again before the contract release's schema
    Given 3.21.0 is installed and the worker finished its background step
    When the upgrade moves to 3.22.0, which ships a contract step
    Then it applies 3.22.0's schema without running the background step again
