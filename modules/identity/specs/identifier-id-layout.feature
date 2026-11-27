Feature: Identifier ids keep the layout they were stored in

  Identifier ids are KSUIDs derived from the fact (ADR-101 §3). `@langwatch/ksuid` now writes
  the "v2" byte layout, and identifiers stored before #9575 carry "v1-legacy" bytes. No stored
  id ever changes: every writer derives both candidates, reuses whichever the user's rows
  already hold, and gives a v2 id only to an identifier nothing holds yet.

  @unit
  Scenario: A new identifier gets a v2 id
    Given a user whose rows hold no identifier for an attach
    When the attach is guarded
    Then the identifier id it states is the v2 candidate

  @unit
  Scenario: A legacy identifier is matched by its legacy id
    Given a user whose folded rows hold the identifier under its v1-legacy id
    When the same identifier is attached again
    Then nothing is stated
    And no v2 row is added beside the legacy one

  @unit
  Scenario: A provisional legacy identifier keeps its legacy id
    Given a newborn user whose provisional row holds the identifier under its v1-legacy id
    When the attach is guarded
    Then the identifier id it states is the v1-legacy candidate

  @unit
  Scenario: Attaching the same identifier twice gives one row
    Given a user whose rows hold no identifier
    When the same attach runs twice, the first one folded
    Then the user holds exactly one identifier row

  @unit
  Scenario: A backfill plan adopts a stored identifier under its legacy id
    Given the user's stored rows hold an identifier under its v1-legacy id
    When the identifier id is derived for that fact
    Then the v1-legacy id is reused

  @unit
  Scenario: A fact naming the other layout of a held identifier folds into the held row
    # Old and new releases side by side, or a rollback, can derive the other
    # layout for an identifier already held: it must not add a second row.
    Given a user who holds an identifier under its v1-legacy id
    When a fact names the same identifier under its v2 id
    Then the fact folds into the held row
    And the user still holds exactly one identifier row
