Feature: The browser caches a read in memory, and on disk only when its contract says so
  The server never answers `unchanged`: it always sends the full answer. A read is trusted for
  five minutes, refetched sooner by a read hint (packages/api/specs/read-hints.feature). A read
  whose contract declares `persist` is also mirrored to a sealed IndexedDB store so a reload
  paints at once. Event-sourced reads will later answer by projection cursor (not built yet).
  ADR: dev/docs/adr/164-browser-query-cache-tiers.md

  Background:
    Given a browser application whose query client applies the declared cache policies

  @unit
  Scenario: A newer session version invalidates every read
    Given reads were fetched under session version 7
    When any answer carries session version 8
    Then every read is marked stale and the mounted ones refetch

  @unit
  Scenario: An equal, older or unreadable session version changes nothing
    Given reads were fetched under session version 7
    When an answer carries version 7, 6, no version, or a value that is not a number
    Then nothing is invalidated

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
    Given a read sent with a held version was persisted with version "v1"
    When the document reloads and the read is revalidated
    Then the request carries since "v1"

  @integration
  Scenario: Logout wipes the store
    Given a persisted cache on this device
    When the user signs out
    Then every persisted query cache is removed and unrelated entries are kept

  # The mirror is sealed per session and the seal expires: every row on disk is AES-GCM under
  # the session's key for a seven-day epoch, which the session read hands over with last
  # epoch's key. A new session after expiry gets a new key, so its old mirror is refetched.

  @integration
  Scenario: A sealed row restores on a refresh in the same session
    Given a persisted read was sealed under this session's key for this epoch
    When the document refreshes, or a new tab opens, in the same session
    Then the read is drawn from disk
    And the store never holds its data in clear

  @integration
  Scenario: A row from another session is a miss and is refetched
    Given a persisted read was sealed by an earlier session of the same user
    When the user signs in again and the document restores it, or a tab adopts it on focus
    Then nothing is drawn from disk
    And the row is removed so the read is fetched again and overwritten

  @unit
  Scenario: A revoked session's key is gone
    Given a browser session whose row was revoked
    When the browser polls its session
    Then the answer carries no document and no key

  @integration
  Scenario: A row sealed last epoch restores and is re-sealed with this epoch's key
    Given a persisted read was sealed under last epoch's key
    When the document restores it with this epoch's key and last epoch's
    Then the read is drawn from disk
    And the row is re-sealed under this epoch's key in the background

  @integration
  Scenario: A row sealed two epochs ago is a miss
    Given a persisted read was sealed two epochs ago in a long sliding session
    When the document restores it with this epoch's key and last epoch's
    Then nothing is drawn from disk and the row is removed

  @integration
  Scenario: A tampered row is a miss
    Given a persisted row whose sealed bytes were changed on disk
    When the document restores it
    Then nothing is drawn from disk and the row is removed

  @integration
  Scenario: The session read is never mirrored
    Given the session read answers and is cached, even with its path marked persist
    When the cache is saved
    Then no row for the session read is in the store

  @integration
  Scenario: Without a key nothing is mirrored
    Given the session read carried no cache key
    When a persisted read is cached
    Then nothing is written to the store

  # Each user's mirror is bounded: 25 MB, 500 rows, 2 MB a row, least recently read first out.

  @integration
  Scenario: Over budget, the least recently read row is evicted
    Given a user's mirror holds as many rows as its budget allows, known from the restore
    When another read is mirrored
    Then the row read least recently is removed and the new one is kept

  @integration
  Scenario: Reading a row protects it from eviction
    Given two mirrored rows, the older of which was read since
    When a third read takes the mirror over budget
    Then the row nobody read is removed and the read one is kept

  @integration
  Scenario: A row too large is not mirrored
    Given a read whose answer is larger than one row may be
    When it lands
    Then nothing is written, the smaller copy it replaces is removed, and it is logged once per path

  # A screen can say how old a restored read is and whether the network has confirmed it.

  @integration
  Scenario: Restored data is unconfirmed, as of its original fetch
    Given a read restored from disk that was fetched a minute before the reload
    Then its freshness is unconfirmed, as of that original fetch

  @integration
  Scenario: A restored read is confirmed when a fetch lands
    Given a read restored from disk
    When a fetch for it lands
    Then its freshness is confirmed, as of the new answer

  @integration
  Scenario: A failed fetch leaves a restored read unconfirmed
    Given a read restored from disk
    When a fetch for it fails
    Then its freshness stays unconfirmed, as of the original fetch

  @unit
  Scenario: The same session and epoch always get the same cache key
    Given the deployment's session secret
    When the cache key is derived twice for one server-resolved session and epoch
    Then both keys are the same 256-bit key

  @unit
  Scenario: Two sessions get different cache keys
    Given the deployment's session secret
    When the cache key is derived for two sessions, or for a session and someone browsing as its user
    Then the keys differ

  @unit
  Scenario: A key expires with its epoch
    Given the deployment's session secret and a seven-day epoch on the server's clock
    When the cache key is derived for one session in this epoch and the last
    Then the keys differ

  @unit
  Scenario: The session read carries this epoch's key and the last
    Given a signed-in browser polls its session
    Then the document carries its session's key for the server's epoch and for the one before

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
  Scenario: A versioned read sends the version it holds
    Given a read sent with a held version is cached under version "v1"
    When the read is asked again
    Then the request carries since "v1"
    And no since is sent when nothing is cached

  @unit
  Scenario: An unchanged answer keeps the cached data
    Given a read sent with a held version is cached under version "v1"
    When the server answers unchanged
    Then the caller receives the cached data

  @unit
  Scenario: A new version replaces the data
    Given a read sent with a held version is cached under version "v1"
    When the server answers version "v2" with new data
    Then the caller receives the new data
    And version "v2" is remembered for the next request

  @unit
  Scenario: A fetch in the focused tab announces its version, never its data
    Given this tab is focused and holds a persisted read
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
  Scenario: A hidden or unfocused tab makes no calls
    Given a tab that is hidden or whose window is blurred
    Then it is not focused for polling or revalidation

  @unit
  Scenario: A forbidden read refetches the session once
    Given any read other than the session read fails with HTTP 403
    When many reads fail with 403 at once
    Then the session read is refetched once and nothing else is invalidated
    But a 403 on the session read itself, or any other failure status, refetches nothing
