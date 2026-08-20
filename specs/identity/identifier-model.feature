Feature: The identifier model - identity as an event-sourced pipeline
  As the LangWatch platform
  I need every sign-in method a user holds recorded as an event-sourced
  identifier with a queryable lifecycle
  So that routing, linking, SSO connections and Auth0 migrations have real
  identity data to build on, while sign-in itself never changes behavior

  # D01 of the identity platform program (ADR-101, revised 2026-08-20;
  # dev/docs/identity-platform/D01-identity-pipeline-and-identifiers.md).
  #
  # The truth split - no table mixes truths, ADR-022/015 stand unamended:
  #
  #   ClickHouse event_log ──fold──► Identifier (PG, pure event-truth,
  #        │  (waited append,          whole-row replay, born clean)
  #        │   calling-path apply,
  #        │   staging best-effort)
  #        └── never carries secrets; emails yes (erasure wipes them, R11)
  #
  #   Account / Session / VerificationToken (PG) - pure row-truth protocol
  #   tables written by repositories; never projections, never in replay.
  #
  # Rollout is the grants arc re-tenanted to users: the adapter's
  # command-emitting paths sit behind a per-user write gate that ships
  # CLOSED and opens as each user's backfill lands (PR 2); deploying PR 1
  # changes nothing on its own.

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
  Scenario: Concurrent verification races dead-end the loser
    Given another user already holds a VERIFIED identifier for "sam.j@acme.com"
    When a verify_identifier command is handled for "sam"'s ATTACHED identifier with the same value
    Then the identifier dead-ends instead of verifying

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
  Scenario: The adapter's write gate ships closed for every user
    Given the identity adapter is deployed and no backfill has run
    When better-auth writes any protocol row for "sam"
    Then the row is written exactly as the stock adapter would
    And no identity command is dispatched and no event is emitted

  @unit
  Scenario: A latched user's domain-significant writes produce events structurally
    Given "sam"'s identifier backfill has latched
    When better-auth creates an account row for "sam" through the adapter
    Then the attach ceremony runs as an identity command before the row exists
    And a vetoed ceremony refuses the protocol write too

  @unit
  Scenario: An unrouted better-auth write is refused and named
    Given a better-auth model+operation missing from the adapter routing table
    When better-auth writes to it
    Then the write is refused naming the model and operation
    And the routing coverage test pins the full mounted surface in CI

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

  @unimplemented
  Scenario: The backfill adopts existing accounts and proves itself per user
    Given "sam" has legacy Account rows and a User.email
    When the identity backfill migrates "sam"
    Then adoption events carry each source row's own business time
    And "sam" is finalized only when the fold-built rows match what the live rows imply
    And a disagreement holds "sam" at migrated with a diff report
