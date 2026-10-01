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
    And the other build's entries are removed

  @unimplemented
  Scenario: Each persisted read is its own object
    Given two persisted reads are cached
    When one of them is refetched
    Then only that read's object in the store is rewritten

  @integration
  Scenario: A corrupt entry is dropped and the rest restore
    Given the store holds one entry that is not a stored read and one valid entry
    When the document reloads
    Then the valid read is drawn from disk
    And the corrupt entry is removed

  @integration
  Scenario: Without IndexedDB the cache lives in memory
    Given IndexedDB is unavailable, as in a private window
    When a persisted read is cached
    Then reading it back during this document works
    And nothing is written to disk

  @integration
  Scenario: A restored version is sent as since
    Given a versioned read was persisted with version "v1"
    When the document reloads and the read is revalidated
    Then the request carries since "v1"

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

  @unit
  Scenario: A versioned read sends the version it holds
    Given a read declared versioned is cached under version "v1"
    When the read is asked again
    Then the request carries since "v1"
    And no since is sent when nothing is cached

  @unit
  Scenario: An unchanged answer keeps the cached data
    Given a versioned read is cached under version "v1"
    When the server answers unchanged
    Then the caller receives the cached data

  @unit
  Scenario: A new version replaces the data
    Given a versioned read is cached under version "v1"
    When the server answers version "v2" with new data
    Then the caller receives the new data
    And version "v2" is remembered for the next request

  @unit
  Scenario: A fetch in the focused tab announces its version, never its data
    Given this tab is focused and holds a read that stays fresh beyond a refetch
    When a fetch for that read lands
    Then the tab broadcasts the read's key and version only

  @unit
  Scenario: A tab behind an announced version marks the read stale without fetching
    Given another tab announces version "v2" for a read this tab holds at "v1"
    When the message arrives
    Then the read is marked stale and nothing is fetched

  @unit
  Scenario: A tab already at the announced version does nothing
    Given another tab announces version "v1" for a read this tab holds at "v1"
    When the message arrives
    Then the read is left as it is

  @unit
  Scenario: A message that is not a key and a version is ignored
    Given a message without a version arrives on the channel
    Then no read is marked stale

  @unimplemented
  Scenario: A tab refused a broadcast channel still syncs on focus
    Given the browser refuses to open a BroadcastChannel
    When the tab gains focus with a stale read
    Then the read is revalidated as usual

  @unit
  Scenario: Gaining focus reads the disk before the network
    Given a read was marked stale by another tab's announcement
    And the stored copy is newer than the tab's
    When the tab gains focus
    Then the stored copy is drawn and nothing is fetched

  @unimplemented
  Scenario: Gaining focus fetches only a read still behind
    Given a read was marked stale and the stored copy is not newer
    When the tab gains focus
    Then the read is fetched once, with its version as since

  @unimplemented
  Scenario: A versioned read is asked again on focus only after the cooldown
    Given a versioned read was fetched less than 60 seconds ago
    When the tab gains focus
    Then it is not fetched
    And a read fetched more than 60 seconds ago is revalidated

  @unimplemented
  Scenario: A hidden or unfocused tab makes no calls
    Given a tab that is hidden or whose window is blurred
    Then it is not focused for polling or revalidation
