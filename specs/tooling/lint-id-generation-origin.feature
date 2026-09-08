Feature: The id-generation-origin lint rule
  Every id the platform mints is a ksuid behind a kind prefix, so an id says
  what it names and sorts by time. A feature or process source that imports
  nanoid or uuid, or calls randomUUID, starts a second scheme that does
  neither.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An import of nanoid or uuid is reported with the house import
    Given a strict feature module or a process module importing nanoid or uuid
    When the id-generation-origin rule runs over it
    Then it reports foreignIdModule naming the module
    And the fix names generate from @langwatch/ksuid with a kind prefix

  @unit
  Scenario: A randomUUID call is reported with the house import
    Given a strict feature module calling randomUUID() bare or as crypto.randomUUID()
    When the id-generation-origin rule runs over it
    Then it reports randomUuid once per call

  @unit
  Scenario: A ksuid import is left alone
    Given a strict feature module importing generate from @langwatch/ksuid
    When the id-generation-origin rule runs over it
    Then it reports nothing
