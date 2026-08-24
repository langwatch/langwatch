Feature: SsoConnection - enterprise SSO becomes an aggregate with a guarded lifecycle
  As a LangWatch operator and an organization using enterprise SSO
  I need every connection to be event-sourced data with a guarded lifecycle
  So that SSO configuration has history, guards, and self-service later,
  instead of two hand-set strings nobody can audit

  # D04 (ADR-117 §5). Aggregate sso_connection in the identity pipeline,
  # tenantId = organizationId.
  #
  #   DRAFT → CLAIMED → APPROVED → VERIFICATION_PENDING → VERIFIED → ACTIVE
  #             │  └→ REJECTED (re-claimable)              ACTIVE ⇄ SUSPENDED
  #             └→ DISCARDED           ACTIVE|SUSPENDED → TEARDOWN_PENDING
  #                                              └→ TORN_DOWN (grace elapsed)
  #
  # Domain claims need LangWatch ops manual approval - no blocklist; DNS TXT
  # (or license token, self-hosted) proves the domain; first verifier owns,
  # globally on SaaS. Existing ssoDomain/ssoProvider orgs are grandfathered
  # by a system migration whose finalized proof is a routing comparison -
  # the same one SSOCONN_ROUTING shadow mode runs. Secrets follow ADR-101's
  # payload rule: events carry references and token hashes, never values.

  Background:
    Given the identity pipeline is registered with the event-sourcing framework
    And an organization "acme" with an org admin "ana"

  # ── Lifecycle and guards ───────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Registering a connection starts a DRAFT with history
    When a register_connection command is handled for "acme" with type "oidc"
    Then a connection_registered event is appended under tenant "acme"
    And the SsoConnection projection row is DRAFT
    And the event carries a client id reference, never a client secret

  @unit @unimplemented
  Scenario: A claimed domain waits for ops approval
    Given a DRAFT connection for "acme"
    When "ana" claims the domain "acme.com"
    Then the connection is CLAIMED and the claim is an audited event
    And nothing routes for "acme.com" yet

  @unit @unimplemented
  Scenario: Ops approval and rejection are both recorded and recoverable
    Given a CLAIMED connection for "acme.com"
    When an ops user approves the claim
    Then the connection is APPROVED and the approver is on the event
    But a rejection records the note and leaves the domain re-claimable

  @unit @unimplemented
  Scenario: Domain verification stores the proof's hash, never the token
    Given an APPROVED connection for "acme.com"
    When verification is requested with the DNS method
    Then the verification_requested event carries the token's hash
    And finding the TXT record moves the connection to VERIFIED

  @unit @unimplemented
  Scenario: A domain owned by another ACTIVE connection cannot be verified
    Given "acme.com" is verified on another organization's ACTIVE connection
    When "acme" requests verification for "acme.com"
    Then the command is refused and no event is emitted
    And the first verifier keeps the domain

  @unit @unimplemented
  Scenario: Activation requires a verified domain and a live break-glass binding
    Given a VERIFIED connection for "acme" with no live break-glass binding
    When an activate command is handled
    Then the command is refused
    And with a live binding and a recorded test login, activation succeeds

  @unit @unimplemented
  Scenario: Suspension is always available and reversible
    Given an ACTIVE connection for "acme"
    When a suspend command is handled
    Then the connection is SUSPENDED and stops routing its domains
    And a resume command restores ACTIVE and routing

  @unit @unimplemented
  Scenario: Teardown never strands a user
    Given an ACTIVE connection whose identifiers are some user's only sign-in method
    When a request_teardown command is handled
    Then the command is refused naming the invariant
    And once every affected user holds another verified method, teardown proceeds

  @unit @unimplemented
  Scenario: Teardown completes only after its grace period
    Given a connection in TEARDOWN_PENDING
    When the grace period elapses
    Then the connection becomes TORN_DOWN through the process manager's wake
    And its domains route nowhere

  @unit @unimplemented
  Scenario: The projection replays whole-row like every identity projection
    Given a connection with a full lifecycle of events
    When the SsoConnection projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row

  # ── Grandfathering ─────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A legacy SSO organization is grandfathered without noticing
    Given "acme" carries legacy ssoDomain "acme.com" and a provider string
    When the connection grandfather migration runs for "acme"
    Then backfill events produce a connection marked as legacy-grandfathered
    And the connection is VERIFIED and ACTIVE from history
    And "acme"'s users sign in exactly as before

  @unit @unimplemented
  Scenario: The grandfather migration is idempotent per organization
    Given "acme" was grandfathered on an earlier pass
    When the migration runs for "acme" again
    Then no event is appended and exactly one connection exists

  @unit @unimplemented
  Scenario: A grandfathered organization finalizes on routing agreement
    Given "acme"'s grandfathered connection exists
    When the migration proves "acme"
    Then it compares the connection-based routing decision with the string-based one for every domain "acme" carries
    And agreement finalizes "acme", and a disagreement holds it with the domains named

  @unit @unimplemented
  Scenario: Grandfathered state never weakens a live guard
    Given a grandfathered ACTIVE connection with no live break-glass binding
    When any state change is commanded
    Then the same guards apply as for a self-served connection

  # ── Routing flip ───────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Shadow mode compares connection routing against string routing
    Given the connection routing flag is in shadow
    When any user signs in through a routed domain
    Then both lookups run and a disagreement is logged with both answers
    And the string-based answer keeps deciding the sign-in

  @unit @unimplemented
  Scenario: After the flip, the strings stop being written
    Given the connection routing flag is enforced
    When SSO configuration changes
    Then only connection commands change it
    And the legacy string columns are derived, no longer written

  @unit @unimplemented
  Scenario: Backoffice edits go through commands like everyone else's
    Given an ops user editing a connection in the backoffice
    When they change the connection
    Then the change is a guarded command with the actor recorded
    And no raw table edit exists on the surface
