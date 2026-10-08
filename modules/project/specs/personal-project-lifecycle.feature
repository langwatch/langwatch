Feature: A personal project follows its personal team
  Organization owns a member's personal team and records what happens to it as facts; project owns
  the personal project and reacts from its own side (ruling C, 2026-10-08). Every reaction is
  idempotent, since a fact may be delivered more than once.

  Scenario: A removed member's personal project is archived with their personal team
    Given a member whose personal team holds their personal project
    And a shared project in another team
    When organization records that the member's personal workspace was archived
    Then the personal project is archived at the moment the fact names
    And the shared project stays live

  Scenario: An archive delivered twice keeps the first archive time
    Given a personal project archived by an earlier delivery
    When the same archive fact arrives again later
    Then the personal project keeps its first archive time

  Scenario: A revived personal team revives its personal project
    Given an archived personal project in an archived personal team
    When organization records that the personal workspace was revived
    Then the personal project is live again

  Scenario: A personal workspace's feature switches land on its personal project
    Given a personal project with every feature switched off
    When organization records that its owner switched every feature on
    Then the personal project stores every feature as on

  Scenario: Feature switches never land on a shared project
    Given a shared project
    When a features fact names it
    Then the shared project's stored switches are unchanged
