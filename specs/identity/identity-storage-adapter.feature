Feature: The identity storage adapter - one adapter, two branches, Account retires
  As the LangWatch platform
  I need better-auth's storage served by one identity-owned adapter that
  routes each user between the stock behavior and event-sourced storage
  So that new and migrating users get single-truth tables and multi-email
  sign-in, while every existing user's authentication is byte-for-byte
  untouched until their own migration finishes

  # ADR-116. The end state:
  #
  #                    better-auth (always, everyone)
  #                                │
  #              identity adapter (createAdapterFactory base)
  #                                │
  #              per-USER gate: finalized-only, fail-closed
  #                 /                             \
  #         legacy branch                  identity branch
  #         stock Prisma CRUD              linkage: fact → fold → Identifier
  #         (Account rows,                 secrets: AccountCredential (row)
  #          authoritative)                reads: Identifier ⋈ AccountCredential
  #
  # The adapter is the implementation createAdapterFactory is built AROUND,
  # never a wrapper over a finished adapter: the factory satisfies fallback
  # joins and transactions through its base, so a wrapper above the factory
  # is blind to the factory's own traffic.
  #
  # Only the `user` and `account` models are routed, and user-model READS are
  # never routed: the User table is complete for both populations, so
  # searches, counts and listings serve from it unchanged. Sessions,
  # verifications and rate limits are row-truth for both populations forever
  # (ADR-101 R12). Secrets never enter the event log (the payload rule);
  # during the bridge phase the identity branch mirrors secret writes onto
  # the Account row, and the heal pass copies newer legacy-written secrets
  # back, so either branch authenticates at any moment.
  #
  # Phases: (1) bridge - stock adapter + databaseHooks + fold dual-projection
  # (shipping today); (2) the adapter goes live and latched users take the
  # identity branch; (3) last tenant finalized - legacy branch, ceremonies,
  # parity check and the Account table are deleted.

  Background:
    Given the identity pipeline is registered with the event-sourcing framework
    And the identity storage adapter is better-auth's only database entry

  # ── Routing ────────────────────────────────────────────────────────────

  @unit
  Scenario: An unlatched user's storage traffic is the stock adapter's, byte for byte
    Given a user "olga" whose identifier backfill has not finalized
    When better-auth creates, reads, updates and deletes "olga"'s account rows
    Then every operation executes the stock Prisma behavior against Account
    And no identity event is appended
    And no AccountCredential row is written

  @unit
  Scenario: A latched user's account create states the fact instead of owning the row
    Given a user "sam" whose identifier backfill is finalized
    When better-auth creates an account for "sam" with provider "google"
    Then an identifier_attached event is appended under tenant "sam"
    And the fold projects the Identifier row before the operation returns
    And the secret columns of the create land in an AccountCredential row
    And no secret appears in any event payload

  @unit
  Scenario: Sessions and verifications take the stock branch for everyone
    Given a user "sam" whose identifier backfill is finalized
    When better-auth writes a session and a verification for "sam"
    Then both writes execute the stock Prisma behavior
    And no identity event is appended

  @unit
  Scenario: A read that names no user routes by resolution, then by gate
    Given "sam" is finalized and "olga" is not
    When better-auth looks up each user by email
    Then "sam" resolves on the identity branch from the Identifier projection
    And "olga" misses the Identifier read and resolves via the legacy branch
    And each lookup returns exactly one user

  @unit
  Scenario: A held user is served wholly by the legacy branch
    Given a user "ines" whose backfill state is migrated but not finalized
    And "ines" has Identifier rows the parity proof found disagreeing
    When better-auth reads and writes "ines"'s account data
    Then every operation takes the legacy branch
    And the next backfill pass heals her projection, not the adapter

  @unit
  Scenario: Admin user searches are never routed
    Given "sam" is finalized and "olga" is not
    When the admin plugin searches users by a name fragment across both populations
    Then the query serves from the User table
    And no unsupported-query failure occurs
    And latched users appear with their primary email

  # ── The reads the adapter must serve ───────────────────────────────────

  @integration
  Scenario: The joined sign-in read is served from the identity tables
    Given a finalized user "sam" with a credential account
    When better-auth signs "sam" in by email with the account join
    Then the factory's fallback join lands on the identity adapter's own findMany
    And the account rows returned are assembled from Identifier and AccountCredential
    And sign-in succeeds with the password held in AccountCredential

  @unit
  Scenario: Sign-in resolves by any verified email, not only the primary
    Given a finalized user "sam" with verified identifiers "sam@acme.com" and "sam@home.net"
    And "sam@acme.com" is the PRIMARY identifier
    When better-auth looks up the user by "sam@home.net"
    Then the identity branch resolves "sam"
    And the user record presents "sam@acme.com" as the email

  @unit
  Scenario: A plus-addressed sign-in still resolves after the latch
    Given a finalized user "sam" whose identifier is "sam.j@acme.com"
    When better-auth looks up the user by "Sam.J+news@Acme.com"
    Then the identity branch applies the attach-time normalization to the query value
    And "sam" is resolved
    And the same address resolved the same user before she latched

  @integration
  Scenario: The OAuth callback resolves the provider subject through the identity tables
    Given a finalized user "sam" with a google identifier whose provider subject is "g-123"
    When the callback looks up the account by "google" and "g-123" with its user join
    Then "sam" is resolved from the Identifier projection
    And the joined user read completes
    And the same lookup for a held user falls through to the legacy branch

  # ── Secrets stay row-truth ─────────────────────────────────────────────

  @unit
  Scenario: A token refresh writes a credential row and states nothing
    Given a finalized user "sam" with a Google account on the identity branch
    When the provider rotates "sam"'s access and refresh tokens
    Then the AccountCredential row is updated in place
    And no identity event is appended
    And a from-scratch replay reproduces the Identifier row and never touches the credential row

  @unit
  Scenario: Bridge mirroring keeps the fail-closed direction safe
    Given a finalized user "sam" changes their password on the identity branch
    And the Account bridge table still exists
    When the credential write commits
    Then the same secret values are mirrored onto "sam"'s Account row
    And a later gate outage that falls "sam" back to the legacy branch still verifies the new password

  @unit @unimplemented
  Scenario: A secret written on the legacy branch after latch is healed
    Given a finalized user "olga" whose password change landed on the legacy branch during the gate's cache window
    When the heal pass runs
    Then the newer Account secret columns are copied onto "olga"'s AccountCredential row
    And her next sign-in verifies the new password

  @unit
  Scenario: An unreadable gate cache degrades writes to the legacy branch, never to an error
    Given the gate cache cannot be read
    When a user's account rows are written
    Then the adapter serves every routed write from the legacy branch
    And write outcomes are unchanged for the duration of the cache TTL

  @unit
  Scenario: Resolution reads do not depend on the gate cache
    Given the gate cache cannot be read
    When a finalized user signs in with a secondary verified email
    Then the resolution read answers from the Identifier projection and its joined migration-state row
    And sign-in succeeds

  # ── Born finalized ─────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A flagged sign-up is born finalized
    Given the sign-up request carries the identity-branch opt-in for its organization
    When better-auth creates the user
    Then the attach facts are appended under the new user's tenant
    And the Identifier row and the AccountCredential row exist when sign-up returns
    And the user's migration-state row is finalized
    And the user's next write takes the identity branch

  @unit @unimplemented
  Scenario: The whole flagged request routes to the identity branch
    Given the sign-up request carries the identity-branch opt-in
    When better-auth creates the user and then the credential account in the same request
    Then the account create states its fact and writes an AccountCredential row
    And no legacy Account write occurs for the newborn

  @unit @unimplemented
  Scenario: A retried flagged sign-up converges instead of duplicating
    Given a flagged sign-up appended its facts and failed before the rows committed
    When the sign-up is retried
    Then the event store dedupes on the idempotency key and exactly one fact set exists
    And exactly one Identifier row and one user row exist after the retry

  @unit @unimplemented
  Scenario: An abandoned flagged sign-up leaves no reachable identity
    Given a flagged sign-up appended its facts and was never retried
    When the address it used is looked up
    Then no user resolves on either branch
    And the reconciliation sweep removes the orphaned stream

  @unit @unimplemented
  Scenario: A flagged sign-up fails loudly when the engine is unavailable
    Given the sign-up request carries the identity-branch opt-in
    And the event-sourcing engine cannot accept an append
    When better-auth creates the user
    Then sign-up fails with the handled code "identity_engine_unavailable"
    And no user row is created on either branch
    But an unflagged sign-up at the same moment succeeds on the legacy branch

  @unit @unimplemented
  Scenario: An unflagged sign-up is untouched
    Given the sign-up request carries no identity-branch opt-in
    When better-auth creates the user
    Then the user is created by the stock Prisma behavior
    And no identity event is appended
    And the user's gate remains closed

  # ── One writer for User.email ──────────────────────────────────────────

  @unit @unimplemented
  Scenario: An email change on the identity branch is a command, not a column write
    Given a finalized user "sam"
    When better-auth updates "sam"'s email
    Then the update is dispatched as an identity command the guard evaluates
    And User.email is written only by the fold, from the PRIMARY identifier

  @unit
  Scenario: A primary switch that collides is refused by the guard, not the database
    Given "sam@home.net" is already another user's User.email
    When "sam" promotes "sam@home.net" to PRIMARY
    Then the guard refuses with the handled code "identity_email_in_use"
    And no event is appended and no row changes

  # ── Collisions across both populations ─────────────────────────────────

  @unit
  Scenario: Verification is refused when a legacy user holds the address
    Given a legacy user "bob" whose User.email is "bob@acme.com"
    And a finalized user "sam" has attached "bob@acme.com"
    When "sam" tries to verify it
    Then the verification is refused with the handled code "identity_email_in_use"
    And no event is appended
    And "bob" still resolves by that address

  @unit
  Scenario: A legacy sign-up cannot claim a latched user's verified address
    Given a finalized user "sam" with the verified secondary identifier "sam@home.net"
    When someone signs up on the legacy branch with "sam@home.net"
    Then the sign-up is refused as a duplicate address
    And no user is created

  @unit
  Scenario: A guard refusal reaches the customer as named copy
    Given a finalized user "sam" verifying an address another user holds
    When the guard refuses the verification
    Then the auth response carries the handled code "identity_email_in_use"
    And the customer-facing copy comes from the presentation registry, never the raw code
    And the verification proof is not consumed by the refusal

  # ── Unlink and erasure ─────────────────────────────────────────────────

  @unit
  Scenario: Unlink on the identity branch detaches the fact and the secrets together
    Given a finalized user "sam" with google and credential identifiers
    When better-auth lists "sam"'s accounts
    Then each account row's id is the pinned account id of its identifier
    When better-auth deletes "sam"'s google account by the id it was given
    Then an identifier_detached event is appended
    And the fold tombstones the Identifier row
    And the AccountCredential row is deleted in the same operation

  @unit @unimplemented
  Scenario: Deleting a user detaches every identifier and erases
    Given a finalized user "sam" with google and credential identifiers
    When better-auth deletes "sam"'s user
    Then a detach fact is appended for each of "sam"'s identifiers
    And the erase command is dispatched
    And "sam"'s AccountCredential rows are deleted
    And "sam"'s sessions are deleted by the stock branch

  # ── Latching an existing user ──────────────────────────────────────────

  @integration @unimplemented
  Scenario: Finalizing an existing user carries their secrets across once
    Given a user "olga" with Account rows holding a password and provider tokens
    When "olga"'s backfill finalizes
    Then each Account row's secret columns are copied into an AccountCredential row
    And the copy preserves the Account row's own timestamps
    And running the copy again inserts nothing

  # ── Upgrade discipline ─────────────────────────────────────────────────

  @unit
  Scenario: An account query shape the identity branch does not recognize fails loudly
    Given a finalized user "sam"
    When better-auth issues an account query with an operator the identity branch has not enumerated
    Then the operation fails with the handled code "identity_unsupported_storage_query"
    And the failure names the model and operator in the log, never in the message
    And no user-model query can raise it
    But the same query for an unlatched user executes on the legacy branch untouched

  @integration
  Scenario: The end-to-end suite is the upgrade net
    Given the real betterAuth library composed over the identity adapter
    When a user signs up, signs in with the account join, lists accounts, changes password, links a provider and deletes the account
    Then every operation succeeds on the identity branch
    And the suite fails if a better-auth upgrade introduces a query shape the branch does not serve
