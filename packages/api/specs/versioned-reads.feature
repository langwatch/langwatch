# ADR: dev/docs/adr/164-browser-query-cache-tiers.md
Feature: A versioned read answers unchanged when the caller holds the current version
  A read declared `cache: { tier, persist, versioned: true }` takes an optional `since`. The tRPC
  host strips it before the handler, hashes what the handler answered and returns
  `{ unchanged: true }` when the hash equals `since`, else `{ version, data }`. The hash is the
  version, so no write bumps anything.

  @unit
  Scenario: A contract declares a versioned read once, with its envelope
    Given a read declared versioned with an input and an answer
    When the contract is built
    Then the declared input gains an optional since
    And the declared output is unchanged or a version with the data
    And the member carries the versioned cache policy and the answer it wraps
    And a versioned read that already declares since is refused where it is written

  @unit
  Scenario: A caller holding the current version is answered unchanged
    Given a versioned read whose handler answers the same data twice
    When the caller asks again with the version the first answer carried
    Then the answer is unchanged and carries no data

  @unit
  Scenario: A caller holding an older version is answered the new one
    Given a versioned read whose handler answer changed since the caller's version
    When the caller asks with that older version
    Then the answer carries the new version and the new data

  @unit
  Scenario: A caller holding no version is answered the version and the data
    Given a versioned read
    When the caller asks with no since
    Then the answer carries the version and the data

  @unit
  Scenario: The handler is never handed since
    Given a versioned read asked with a since
    When its handler runs
    Then the handler's input holds the read's own arguments and no since

  @unit
  Scenario: No user's version matches another's
    Given two users whose answers are identical
    When each asks a versioned read
    Then the two versions differ
