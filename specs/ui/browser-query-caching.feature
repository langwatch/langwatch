Feature: The browser trusts a read for as long as its tier says, and no longer
  A read's contract declares its cache tier: `live` is always refetched,
  `session` (organization graph, permissions, flags, plan, admin) is trusted
  until the server says the session changed, and `reference` (model provider
  lists, catalogues) for an hour. An undeclared read keeps the 30 second
  default. A few large reads are also kept on disk so a reload paints at once.
  ADR: dev/docs/adr/164-browser-query-cache-tiers.md

  Background:
    Given a browser application whose query client applies the declared tiers

  @unit
  Scenario: A declared tier sets how long a read stays fresh
    Given "organization.getAll" is declared session and "modelProvider.getAllForProject" reference
    When either is read
    Then the session read never goes stale on its own
    And the reference read stays fresh for an hour
    And an undeclared read of the same namespace keeps the 30 second default

  @unit
  Scenario: A newer session version invalidates the session tier
    Given the session tier was fetched under session version 7
    When any answer carries session version 8
    Then every session-tier read is marked stale and the mounted ones refetch
    And reads of other tiers are left alone

  @unit
  Scenario: An equal, older or unreadable session version changes nothing
    Given the session tier was fetched under session version 7
    When an answer carries version 7, 6, no version, or a value that is not a number
    Then nothing is invalidated

  @unit
  Scenario: A refused call invalidates the session tier
    Given a session-tier read is cached
    When a mutation or a read of another tier is answered 403
    Then every session-tier read is marked stale

  @unit
  Scenario: A session read that is itself refused does not loop
    Given a session-tier read is answered 403
    Then the session tier is not invalidated again because of it

  @integration
  Scenario: A reload paints a persisted read from disk, then revalidates it
    Given "organization.getAll" is declared persist and was cached before a reload
    When the document reloads for the same user and build
    Then the organization graph is drawn from disk
    And it is marked stale so it is fetched again behind the painted copy

  @integration
  Scenario: A read not marked persist never reaches the disk
    Given an undeclared read and a persisted read are both cached
    When the cache is saved
    Then only the persisted read is in the store

  @integration
  Scenario: A user switch never shows another user's cache
    Given one user's organization graph is persisted on this device
    When a different user signs in on the same device
    Then the previous user's cache is not restored
    And it is removed from the store

  @integration
  Scenario: A build change discards the store
    Given a persisted cache written by one build
    When a different build restores it
    Then nothing is restored

  @integration
  Scenario: Logout wipes the store
    Given a persisted cache on this device
    When the user signs out
    Then every persisted query cache is removed and unrelated entries are kept

  @unit
  Scenario: Every tRPC answer carries the session version
    Given a signed-in caller in an organization
    When any tRPC procedure answers
    Then the answer carries the "x-lw-session-version" header with the caller's session version

  @unit
  Scenario: A membership or role binding change bumps the version
    Given a caller whose session version is 7
    When a grant to them or their group is attached, revoked or changes role, or a role in their organization changes
    Then the caller's next answer carries a newer session version
    And a grant to an API key or a share link bumps no one

  @unimplemented
  Scenario: A write outside the grants ledger bumps the version
    Given a caller whose session version is 7
    When a team, a project, the organization, a group membership, a flag, the plan or the licence changes
    Then the caller's next answer carries a newer session version

  @unit
  Scenario: A session read answers 304 when its body is unchanged
    Given a session or reference read answered as an unbatched GET with an ETag hashing its body for the caller
    When the browser asks again with that ETag in If-None-Match and the body is unchanged
    Then the server answers 304 with no body

  @unit
  Scenario: A changed body gets a new ETag
    Given a session read answered with an ETag hashing its body for the caller
    When the browser asks again with that ETag and the body has changed
    Then the server answers 200 with the new body and a new ETag

  @unit
  Scenario: One user's ETag never revalidates another user's read
    Given a read answered with an ETag for one user
    When a different user asks with that ETag for a byte-identical body
    Then the server answers 200 with that user's body

  @unit
  Scenario: A live read or a batch never carries an ETag
    Given a read declared live, or several reads batched into one request
    When it answers
    Then the answer carries no ETag and is never answered 304
