Feature: The identifier model - identity as an event-sourced pipeline
  As the LangWatch platform
  I need every sign-in method a user holds recorded as an event-sourced
  identifier with a queryable lifecycle
  So that routing, linking, SSO connections and Auth0 migrations have real
  identity data to build on, while sign-in itself never changes behavior

  # D01 of the identity platform program (ADR-101, revised 2026-08-20,
  # re-based on ADR-110 2026-08-23;
  # dev/docs/identity-platform/D01-identity-pipeline-and-identifiers.md).
  #
  # The truth split - no table mixes truths, ADR-022/015 stand unamended:
  #
  #   ClickHouse event_log ──fold──► Identifier (PG, pure event-truth,
  #        │  (the command is staged        whole-row replay, born clean)
  #        │   onto the queue; the queued
  #        │   run appends AND folds)
  #        └── never carries secrets; emails yes (erasure wipes them, R11)
  #
  #   Session / VerificationToken (PG) - pure row-truth protocol tables
  #   written by repositories; never projections, never in replay.
  #
  #   Account (PG) - under ADR-116 a projection of the same log for as long
  #   as it exists: the fold owns its linkage columns, better-auth its
  #   secret columns, and the table retires when the identity storage
  #   adapter's last phase lands
  #   (specs/identity/identity-storage-adapter.feature).
  #
  # Rollout is ADR-110's shape re-tenanted to users - one migration, and
  # finishing it IS the switch: the ceremonies sit behind a per-user write
  # gate that ships CLOSED and opens only when the user's backfill is
  # finalized (migrated is HELD: the proof found the projection behind or
  # disagreeing, and the next pass heals it). Enrollment is a switch, not a
  # programme: the ops page enrolls organizations and their members migrate;
  # there is no everyone-else cohort. Wiring the ceremonies changes nothing
  # on its own.
  #
  # The ceremonies bind to better-auth's own databaseHooks - account
  # create/delete and user delete - so better-auth keeps the stock
  # prismaAdapter. A `before` hook runs while no row exists and can refuse,
  # which is what keeps veto-before-write true. All three are gated, and an
  # unenrolled organization therefore behaves byte-for-byte as it did before
  # any of this existed: no events, no extra reads of its own, no extra
  # columns written.

  Background:
    Given the identity pipeline is registered with the event-sourcing framework
    And a user "sam" exists with a Google account row and email "sam@acme.com"

  @unit
  Scenario: An identity command round-trips the whole pipeline
    When an attach_identifier command is dispatched for "sam" through the framework
    Then an identity event is appended under tenant "sam"
    And the fold applies it to the Identifier projection
    And the projection cursor advances past the event

  @unit
  Scenario: Attaching an identifier records the fact and the projection row
    When an attach_identifier command is handled for "sam" with provider "google" and value "Sam.J+x@Acme.com"
    Then an identifier_attached event is emitted with the normalized email "sam.j@acme.com"
    And the event payload carries the domain "acme.com" and an HMAC identifier hash
    And the event payload carries no password, token, or other secret
    And folding the event produces an Identifier row in state VERIFIED

  @unit
  Scenario: Identifier ids are deterministic so backfill and live emission converge
    When the same attach fact is emitted twice with the same business time
    Then both events name the same identifier id
    And folding both produces exactly one Identifier row

  @unit
  Scenario: A retried command dedupes at the event store
    When an attach_identifier command with commandId "idcmd_1" is handled twice
    Then both emissions carry the idempotency key "idcmd_1:0"

  @unit
  Scenario: An identity ceremony stages its command and waits for the fold
    Given "sam"'s identifier backfill has latched
    When an attach ceremony commits its facts
    Then the command is staged onto "sam"'s queue lane
    And the staged run is what appends, so exactly one event lands per fact
    And the ceremony waits, bounded, for the fold to move the projection cursor
    But the ceremony never appends or writes the projection itself

  @unit
  Scenario: A ceremony whose command cannot be staged fails
    Given the group queue cannot accept the staged command
    When an attach ceremony commits its facts
    Then the ceremony fails, because nothing would append or fold its facts
    And no event is written, so a retry states the same facts once

  @unit
  Scenario: A lagging fold does not fail the ceremony
    Given the fold does not land inside the convergence window
    When an attach ceremony commits its facts
    Then the ceremony still succeeds and the timeout is counted
    And the projection converges when the queue drains

  @unit
  Scenario: A fact the heads already carry is not stated again
    Given "sam"'s Google identifier is already folded into the projection
    When the same attach is handled again, from a staged re-run or a later backfill pass
    Then no event is emitted and nothing is appended, applied, or staged
    And an attach for an identifier the projection lacks is still emitted

  @unit
  Scenario: Every identity event rides the pipeline's declared aggregate type
    When each identity command emits its event
    Then the event store's own aggregate-type check accepts every one against the pipeline

  @unit
  Scenario: Exactly one PRIMARY identifier per user
    Given "sam" holds a VERIFIED identifier "work" and a PRIMARY identifier "personal"
    When a mark_primary command is handled for "work"
    Then "work" becomes PRIMARY and "personal" returns to VERIFIED

  @unit
  Scenario: A PRIMARY identifier never detaches directly
    Given "sam" holds a PRIMARY identifier "personal"
    When a detach_identifier command is handled for "personal"
    Then the command is refused and no event is emitted

  @unit
  Scenario: A detached identifier is a tombstone, forever resolvable
    Given "sam" holds a VERIFIED identifier "work" and a PRIMARY identifier "personal"
    When a detach_identifier command is handled for "work"
    Then the Identifier row for "work" remains with state DETACHED and a detachedAt timestamp

  @unit
  Scenario: A verification refused because another user holds the address
    Given another user already holds a VERIFIED identifier for "sam.j@acme.com"
    When a verify_identifier command is handled for "sam"'s ATTACHED identifier with the same value
    Then the command is refused with the handled code "identity_email_in_use"
    And no event is emitted

  @unit
  Scenario: Two concurrent verifications of one address: the loser is refused before any fact
    Given two users hold an ATTACHED identifier for the same address
    And the first verification has taken the address lock
    When the second verification is handled
    Then it is refused with the handled code "identity_email_in_use"
    And no event is emitted for it, so the log records no losing verification

  @unit
  Scenario: A retried verification holds the lock it already took
    Given a verification took the address lock and is retried under the same command id
    When the retry is handled
    Then the lock reads as this command's own and the identifier verifies

  @unit
  Scenario: Two VERIFIED arrivals for one address: exactly one holds it
    Given two users' identity providers call back with the same address
    And neither user's projection yet carries the other's identifier
    When both arrivals are handled
    Then exactly one of them ends VERIFIED
    And the other dead-ends, so no address has two proven holders
    And replaying both emissions reaches the same two states

  @unit
  Scenario: A VERIFIED arrival that loses the address lock dead-ends
    Given another user holds the address lock for "sam.j@acme.com"
    When an OAuth identifier arrives VERIFIED for "sam" with the same value
    Then the identifier arrives ATTACHED and dead-ends in the same emission
    And no refusal is raised, because an IdP callback has no caller to act on one

  @unit
  Scenario: An email attach takes no address lock
    When an email identifier is attached for "sam"
    Then no address lock is taken
    And nobody can hold an address by attaching it unverified

  @unit
  Scenario: Replay rebuilds the Identifier projection identically
    Given "sam"'s identity history holds attach, verify, primary-change and detach events
    When the Identifier projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row

  @unit
  Scenario: Erasure wipes values and leaves a replayable tombstone
    Given "sam" holds two identifiers
    When an erase_user command is handled for "sam"
    Then a user_erased event names both identifier ids
    And folding the erasure wipes value and hash fields from "sam"'s Identifier rows
    And replaying "sam"'s history reproduces the tombstone, never the email

  @unit
  Scenario: The write gate ships closed for every user
    Given the identity ceremonies are wired and no backfill has run
    When better-auth writes any row for "sam"
    Then the row is written exactly as it would be with no ceremonies wired
    And no identity command is dispatched and no event is emitted

  @unit
  Scenario: A latched user's domain-significant writes produce events structurally
    Given "sam"'s identifier backfill has latched
    When better-auth is about to create an account row for "sam"
    Then the attach ceremony runs as an identity command before the row exists
    And a vetoed ceremony refuses the row write too
    And the ceremony pins the row's id, so the backfill later derives the same identifier id

  @unit
  Scenario: Deleting a latched user runs the erase ceremony before the row delete
    Given "sam"'s identifier backfill has latched
    When better-auth is about to delete "sam"'s user row
    Then the erase ceremony runs as an identity command before the row delete
    And better-auth runs the hook once per row it resolved, so a batch delete cannot skip one

  @unit
  Scenario: Deleting an unlatched user runs no ceremony; the erasure service reconciles
    Given "sam"'s identifier backfill has not latched
    When better-auth is about to delete "sam"'s user row
    Then the row is deleted exactly as it would be with no ceremonies wired
    And no identity command is dispatched

  @unit
  Scenario: An Account row no identifier mirrors still deletes
    Given "sam"'s identifier backfill has latched
    And no unambiguous Identifier mirrors the Account row being deleted
    When better-auth is about to delete that row
    Then no detach command is dispatched and the row delete proceeds
    And the backfill's next pass detaches whatever the row's absence implies

  @unit
  Scenario: Signing up on an unmigrated organization writes nothing extra
    Given "sam"'s organization has not been enrolled
    When better-auth creates "sam"'s user row
    Then no identity ceremony runs and no identity column is written
    And the backfill mints their userHashKey when it adopts them

  @unit
  Scenario: Email verification completes only with the ceremony's proof
    Given "sam" starts an email verification from a browser holding a PKCE verifier
    When the emailed magic link is opened with a GET request
    Then nothing is verified
    When completion is posted with the token and the matching verifier
    Then the identifier verifies via a verify_identifier command

  @unit
  Scenario: A verification token is pinned to the identifier it was minted for
    Given a verification record minted for identifier "work"
    When completion is posted naming identifier "personal" with that token
    Then the completion is refused and no identifier verifies

  @unit
  Scenario: A mail scanner's prefetch cannot verify an identifier
    Given a verification email delivered through a link-scanning gateway
    When the scanner fetches the magic link
    Then the identifier remains unverified and the token remains unconsumed

  @unit
  Scenario: The backfill adopts existing accounts and proves itself per user
    Given "sam" has legacy Account rows and a User.email
    When the identity backfill migrates "sam"
    Then adoption events carry each source row's own business time
    And "sam" is finalized only when the fold-built rows match what the live rows imply
    And a disagreement holds "sam" at migrated with the outstanding identifiers named

  @unit
  Scenario: The backfill detaches identifiers whose account row is gone
    Given "sam"'s Google account was adopted on an earlier pass
    And the Google Account row has since been deleted
    When the identity backfill migrates "sam" again
    Then the Google identifier is detached with a command id stable across retries
    And the email identifier, which has no account row, is left alone
    And a further pass detaches nothing

  # The READ fork (ADR-101 §5). `User.email` is a legacy column answering a
  # question identity now owns, so a finalized user's email comes from their
  # identifiers and the column is a stale copy. One switch forks both
  # directions: the user whose ceremonies emit events is exactly the user
  # whose identifiers were proven against their legacy rows.

  @unit
  Scenario: The legacy email field answers from the identifiers
    Given "sam"'s identifier backfill has finalized
    And "sam" holds a PRIMARY identifier and a more recently VERIFIED one
    When anything reads "sam"'s user email
    Then the PRIMARY identifier's value answers
    And with no PRIMARY, the most recently VERIFIED one answers instead

  @unit
  Scenario: An unproven address never answers the legacy email field
    Given "sam" holds only ATTACHED, DETACHED or DEAD_END identifiers
    When anything reads "sam"'s user email
    Then no identifier answers, so the legacy column stands
    And attaching an address can therefore never redirect "sam"'s mail

  # ADR-116: `Account` is a PROJECTION of the event log, alongside
  # `Identifier`. During the bridge phase better-auth reads and writes it
  # with the completely stock adapter - nothing intercepts it - and the fold
  # owns its linkage columns. One truth, two projections, until the table
  # retires with the identity storage adapter's last phase.

  @unit
  Scenario: better-auth reads an account through its own storage
    Given "sam"'s organization has finalized
    When better-auth signs "sam" in
    Then its own joined read of the user and their accounts completes
    And nothing sits in front of it to answer differently

  @unit
  Scenario: A password change states nothing, because a secret is not a fact
    Given "sam"'s organization has finalized
    When "sam" changes their password
    Then better-auth rewrites its own row
    And no identity command is dispatched

  @integration
  Scenario: The fold projects the linkage columns of Account
    Given "sam" holds a live identifier carrying an account id and a subject
    When the identity fold stores the projection
    Then the Account row carries the user, provider and subject the fact names
    And the fold writes no other column

  @integration
  Scenario: The projected Account row keeps better-auth's own provider id
    Given "sam" holds a live identifier attached through the provider "auth0"
    And the identifier vocabulary folds that provider into "oidc"
    When the identity fold stores the projection
    Then the Account row's provider is still "auth0"
    And better-auth's own lookup by provider and subject finds the row

  @integration
  Scenario: A replay never overwrites a credential the fold cannot know
    Given an Account row holds an access token better-auth refreshed
    When the fold re-asserts that row from the event log
    Then the token is left exactly as it was
    And a from-scratch replay therefore restores linkage but not secrets

  @integration
  Scenario: A tombstoned identifier projects to no Account row
    Given "sam" holds a DETACHED identifier for a provider subject
    When the identity fold stores the projection
    Then the Account row that identifier projected to is gone
    And no row is created for a tombstone

  @integration
  Scenario: The fold reports a user it cannot find, and projects anyway
    Given the log carries "sam"'s linkage but no User row carries "sam"
    When the identity fold stores the projection
    Then the projection rows are written, so it stays complete
    And the anomaly is reported, rather than being a branch nobody can see

  @unit
  Scenario: The gate costs nothing before anyone is enrolled
    Given no user has finalized the identifier backfill
    When any number of users are checked against the gate
    Then one read per pod settles it for all of them
    And no per-user migration row is read at all
    And the short-circuit disables itself once the first user finalizes

  @unit
  Scenario: An unmigrated user keeps the legacy email column
    Given "sam"'s identifier backfill has not finalized
    When anything reads "sam"'s user email
    Then the projection is not consulted at all
    And the legacy column answers, exactly as it does today

  @unit
  Scenario: An unreadable projection never fails a request
    Given the Identifier projection cannot be read
    When anything reads "sam"'s user email
    Then the legacy column answers and the request proceeds
    And the fallback is logged, because it is otherwise silent

  @unit
  Scenario: Finalizing a user's backfill opens their write gate
    Given "sam"'s backfill pass concludes with matching rows
    When the migration state records "sam" as finalized
    Then the write gate answers open for "sam"
    But a user held at migrated stays closed
    And an operator rollback closes it again

  @unit
  Scenario: Organization enrollment is what puts a user in the backfill's cohort
    Given the installation is cloud
    And "acme" is enrolled in the identifier backfill and "globex" is not
    When a migration pass computes its user cohort
    Then every member of "acme" is in the cohort
    And a user who belongs only to "globex" is not
    And a user outside every organization is not, and stays on the legacy path
