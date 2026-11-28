Feature: Deterministic grant ids keep the layout they were stored in

  A writer that may run twice attaches a grant under an id derived from the grant's own
  content (ADR-092 §13). `@langwatch/ksuid` now writes the "v2" byte layout, and grants stored
  before #9575 carry "v1-legacy" bytes. No stored id ever changes: the writer looks the grant up
  under both candidates, revoked grants included, reuses whichever is stored, and gives a v2 id
  only to a grant nothing holds yet. A revoked grant is never minted afresh beside itself, so a
  re-mint can never restore access a revoke ended.

  @unit
  Scenario: A stored legacy grant keeps its legacy id
    Given a grant stored under its v1-legacy id
    When the grant id is derived for the same fact
    Then the v1-legacy id is reused

  @unit
  Scenario: A new grant gets a v2 id
    Given no grant is stored under either candidate id
    When the grant id is derived
    Then it is the v2 candidate

  @unit
  Scenario: A revoked legacy grant is not re-minted as v2
    Given a legacy API key's organization grant stored under its v1-legacy id
    And that grant has been revoked
    When the read-through mint resolves the grant id and the attach is folded
    Then the resolved id is the revoked grant's v1-legacy id
    And the key holds no live grant

  @unit
  Scenario: Resolving a grant id twice gives one grant row
    Given no grant is stored for a fact
    When the grant id is resolved, attached, and resolved again
    Then both resolutions answer the same v2 id
    And one grant row holds it

  @integration
  Scenario: A v2 read-through mint leaves a revoked row under its legacy id
    # A release from before v2 re-derives the legacy id and its upsert never
    # clears revokedAt. With the twin in place from the mint, a revoke on any
    # release followed by an old mint cannot restore the key's access.
    Given an API key's grant read-through minted under a v2 id
    Then a revoked row exists under its v1-legacy id, with no token
    And upserting the legacy id again leaves that row revoked

  @unit
  Scenario: A grant holding both ids resolves to its v2 id
    Given a v2 grant and its revoked legacy twin are both stored
    When the grant id is resolved
    Then the v2 id is returned
