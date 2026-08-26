Feature: SsoConnection - enterprise SSO becomes an aggregate with a guarded lifecycle
  As a LangWatch operator and an organization using enterprise SSO
  I need every connection to be event-sourced data with a guarded lifecycle
  So that SSO configuration has history, guards, and self-service later,
  instead of two hand-set strings nobody can audit

  # D04 (ADR-117 §5). Aggregate sso_connection, tenantId = organizationId.
  # It rides its OWN pipeline beside the identity one rather than inside it:
  # a pipeline declares one aggregate type and the event store refuses any
  # append that differs from it, and the identity pipeline's is user_identity,
  # tenanted by the user. The vocabulary is still identity's - the events are
  # lw.identity.connection_*, the facts live in @langwatch/identity and the
  # guards in @langwatch/identity-server. Only the storage partition is
  # separate.
  #
  #   DRAFT → CLAIMED → APPROVED → VERIFICATION_PENDING → VERIFIED → ACTIVE
  #             │  └→ REJECTED (re-claimable)              ACTIVE ⇄ SUSPENDED
  #             └→ DISCARDED           ACTIVE|SUSPENDED → TEARDOWN_PENDING
  #                                              └→ TORN_DOWN (grace elapsed)
  #
  # Domain claims need LangWatch ops manual approval - no blocklist; first
  # verifier owns, globally on SaaS. Four things can prove a claimed domain,
  # and which one proved it stays recorded on the connection forever:
  #
  #   dns-txt              the customer publishes the record we gave them
  #   license-token        a self-hosted installation's own licence (D05
  #                        tier 2)
  #   operator-attested    a LangWatch operator states out of band that the
  #                        domain is that organization's (D05 tier 1) -
  #                        amended in, see below
  #   legacy-configuration years of production sign-ins through the old
  #                        strings; stated only by the grandfather migration
  #                        and requestable by nobody
  #
  # AMENDMENT (D05): operator attestation. An operator onboarding a hosted
  # customer already approves that customer's domain claim, and the approval
  # IS the trust decision. Waiting afterwards on a record the customer has to
  # publish buys a round-trip and no security, because the same operator in
  # the same session already decided the claim was genuine. So attestation
  # replaces the PROOF and never the APPROVAL: the claim is still claimed,
  # still approved, still an audited operator's act, and an attested domain
  # is exactly as trustworthy as that approval - no more. It is requestable
  # only by a platform operator, so an organization administrator can never
  # attest their own domain, and hosted self-serve (D05 tier 3) keeps DNS
  # TXT, which is the tier where the customer proves their own domain and
  # where attestation would defeat the point.
  #
  # An attestation does not expire, and there is no later DNS upgrade. The
  # reasoning, written so it can be argued with rather than rediscovered:
  # no other method's verification expires either - DNS TXT expires the
  # TOKEN before it is found, never the verification it produced, and
  # legacy-configuration rests on history that only grows - so an expiry
  # unique to attestation would make the operator path the only one that can
  # stop routing without anybody having decided anything, which is precisely
  # the lockout class the break-glass binding exists to prevent. What an
  # expiry would buy is re-confirmation that the customer still holds the
  # domain; what buys that better is suspend, which is always available,
  # immediate, reversible, and taken by a human at the moment it matters,
  # with teardown behind it. A dispute is resolved from event history, which
  # is what the history is for. An upgrade path would mean a re-verification
  # transition on a live connection that nothing else in the lifecycle
  # needs, serving only the case suspend already serves. The price of
  # standing indefinitely is that the weaker evidence must never become
  # invisible: the connection and the operator lookup always name who
  # attested the domain and when, and an attested domain never reads as one
  # the customer proved.
  #
  # Existing ssoDomain/ssoProvider orgs are grandfathered
  # by a system migration whose finalized proof is a routing comparison -
  # the same one SSOCONN_ROUTING shadow mode runs. Secrets follow ADR-101's
  # payload rule: events carry references and token hashes, never values.
  #
  # Grandfathering states HISTORY rather than commanding a change: one
  # command emits the whole lifecycle a legacy organization would have had,
  # and it can only create - a connection that exists already gets nothing.
  # That is what makes "never weakens a guard" structural: there is no
  # grandfathered branch in any guard, and every later state change is the
  # ordinary guarded verb. Such a domain's verification method is recorded as
  # legacy-configuration, which no ceremony can request: the proof is the
  # years of production sign-ins the strings already served.
  #
  # Everything here ships DARK. SSOCONN_ROUTING defaults off, so the
  # projection decides nothing and no string write stops; at enforce the
  # projection decides and the legacy columns refuse edits. Rollback is the
  # flag.

  Background:
    Given the identity pipeline is registered with the event-sourcing framework
    And an organization "acme" with an org admin "ana"

  # ── Lifecycle and guards ───────────────────────────────────────────────

  @unit
  Scenario: Registering a connection starts a DRAFT with history
    When a register_connection command is handled for "acme" with type "oidc"
    Then a connection_registered event is appended under tenant "acme"
    And the SsoConnection projection row is DRAFT
    And the event carries a client id reference, never a client secret

  @unit
  Scenario: A claimed domain waits for ops approval
    Given a DRAFT connection for "acme"
    When "ana" claims the domain "acme.com"
    Then the connection is CLAIMED and the claim is an audited event
    And nothing routes for "acme.com" yet

  @unit
  Scenario: Ops approval and rejection are both recorded and recoverable
    Given a CLAIMED connection for "acme.com"
    When an ops user approves the claim
    Then the connection is APPROVED and the approver is on the event
    But a rejection records the note and leaves the domain re-claimable

  @unit
  Scenario: Domain verification stores the proof's hash, never the token
    Given an APPROVED connection for "acme.com"
    When verification is requested with the DNS method
    Then the verification_requested event carries the token's hash
    And finding the TXT record moves the connection to VERIFIED

  # ── Operator attestation (D05 amendment) ───────────────────────────────

  @unit
  Scenario: An operator attests a domain instead of waiting for a record
    Given an APPROVED connection for "acme.com"
    When a platform operator attests that "acme.com" belongs to "acme"
    Then the connection is VERIFIED with nothing published anywhere
    And the fact records the attesting operator, the domain and when they attested it

  @unit
  Scenario: Attestation replaces the proof and never the approval
    Given a CLAIMED connection for "acme.com" that nobody has approved
    When a platform operator attests the domain
    Then the command is refused and no event is emitted
    And attesting becomes available only once the claim is approved

  @unit
  Scenario: How a domain was proved is its own recorded method, permanently
    Given one domain proved by a published record and another attested by an operator
    When each connection's history is read
    Then each domain names the method that proved it
    And nothing anywhere can present an attested domain as one the customer proved

  @unit
  Scenario: An organization administrator can never attest their own domain
    Given an APPROVED connection for "acme.com"
    And an administrator of "acme" holding every permission the organization can grant
    When they attest the domain
    Then the command is refused and no event is emitted
    And publishing the record stays the way their domain is proved

  @unit
  Scenario: Attestation is a platform operator's act on any deployment
    Given a self-hosted installation whose platform operator attests a domain
    When the attestation is handled
    Then it succeeds and is recorded against that operator
    And whoever administers the organization still cannot attest it themselves

  @unit
  Scenario: An attested domain cannot take one another ACTIVE connection holds
    Given "acme.com" is verified on another organization's ACTIVE connection
    When a platform operator attests "acme.com" for a second organization
    Then the command is refused exactly as any other method is refused
    And the first verifier keeps the domain

  @unit
  Scenario: An attestation stands until somebody decides otherwise
    Given a domain verified by operator attestation a year ago
    When the connection is read
    Then the domain is still verified and still routing
    And nothing has asked for it to be proved again

  @unit
  Scenario: A disputed attested domain is answered by suspending, not by expiring
    Given a domain verified by operator attestation is disputed
    When an operator suspends the connection
    Then the domain stops routing immediately
    And the attestation, the dispute and the suspension are all readable in the history

  @unit
  Scenario: A domain owned by another ACTIVE connection cannot be verified
    Given "acme.com" is verified on another organization's ACTIVE connection
    When "acme" requests verification for "acme.com"
    Then the command is refused and no event is emitted
    And the first verifier keeps the domain

  @unit
  Scenario: Activation requires a verified domain and a live break-glass binding
    Given a VERIFIED connection for "acme" with no live break-glass binding
    When an activate command is handled
    Then the command is refused
    And with a live binding and a recorded test login, activation succeeds

  @unit
  Scenario: Suspension is always available and reversible
    Given an ACTIVE connection for "acme"
    When a suspend command is handled
    Then the connection is SUSPENDED and stops routing its domains
    And a resume command restores ACTIVE and routing

  @unit
  Scenario: Teardown never strands a user
    Given an ACTIVE connection whose identifiers are some user's only sign-in method
    When a request_teardown command is handled
    Then the command is refused naming the invariant
    And once every affected user holds another verified method, teardown proceeds

  @unit
  Scenario: Teardown completes only after its grace period
    Given a connection in TEARDOWN_PENDING
    When the grace period elapses
    Then the connection becomes TORN_DOWN through the process manager's wake
    And its domains route nowhere

  @integration
  Scenario: An administrator removes their own connection that never went live
    Given "acme" registered a connection that is not yet ACTIVE
    When "ana" removes it from the setup page
    Then the connection is discarded and the journey opens on the register step again
    And nothing about anybody's sign-in changed, and the history keeps what was tried

  @integration
  Scenario: An administrator removes their own live connection on teardown's terms
    Given "acme"'s connection is ACTIVE and nobody would be stranded
    When "ana" removes it from the setup page
    Then the removal is scheduled with teardown's own grace, not completed at once
    And another organization's administrator naming the connection is answered as if it did not exist

  # The grace exists for the people signing in through the connection. A
  # connection the organization is not routing off strands nobody, so its
  # removal owes nobody a week.
  @unit
  Scenario: A removal nothing routes off is scheduled for now, not next week
    Given "acme"'s connection is ACTIVE and routing is not switched on
    When "ana" removes it from the setup page
    Then the teardown deadline is the moment of the ask
    And the wake completes it as soon as it fires

  @unit
  Scenario: Asking again while a removal waits brings the date forward
    Given a connection in TEARDOWN_PENDING with days of grace left
    When the administrator removes it again
    Then the deadline is re-derived from the new ask
    And the stranded-users check runs again on the way through

  # One button, two removals, and the aggregate refuses each from the other's
  # states — so which one a press is has to be read from where the connection
  # stands. Reading it from whether the connection is ACTIVE is the same
  # question asked wrongly: a paused connection and one already being removed
  # are both "not active", neither can be discarded, and the screen offered
  # both a button whose only outcome was a refusal.
  @integration
  Scenario: Which removal a press sends is read from where the connection stands
    Given "acme"'s connection is paused, or already scheduled for removal
    When "ana" removes it from the setup page
    Then the connection is torn down on teardown's terms, never discarded
    And a connection already being removed says so on the page, and says when

  @unit
  Scenario: The projection replays whole-row like every identity projection
    Given a connection with a full lifecycle of events
    When the SsoConnection projection is rebuilt from the event log alone
    Then every rebuilt row equals the live row, whole-row

  # ── Grandfathering ─────────────────────────────────────────────────────

  @integration
  Scenario: A legacy SSO organization is grandfathered without noticing
    Given "acme" carries legacy ssoDomain "acme.com" and a provider string
    When the connection grandfather migration runs for "acme"
    Then backfill events produce a connection marked as legacy-grandfathered
    And the connection is VERIFIED and ACTIVE from history
    And "acme"'s users sign in exactly as before

  @unit
  Scenario: The grandfather migration is idempotent per organization
    Given "acme" was grandfathered on an earlier pass
    When the migration runs for "acme" again
    Then no event is appended and exactly one connection exists

  @unit
  Scenario: A grandfathered organization finalizes on routing agreement
    Given "acme"'s grandfathered connection exists
    When the migration proves "acme"
    Then it compares the connection-based routing decision with the string-based one for every domain "acme" carries
    And agreement finalizes "acme", and a disagreement holds it with the domains named

  @unit
  Scenario: Grandfathered state never weakens a live guard
    Given a grandfathered ACTIVE connection with no live break-glass binding
    When any state change is commanded
    Then the same guards apply as for a self-served connection

  # ── Routing flip ───────────────────────────────────────────────────────

  @unit
  Scenario: Shadow mode compares connection routing against string routing
    Given the connection routing flag is in shadow
    When any user signs in through a routed domain
    Then both lookups run and a disagreement is logged with both answers
    And the string-based answer keeps deciding the sign-in

  @unit
  Scenario: After the flip, the strings stop being written
    Given the connection routing flag is enforced
    When SSO configuration changes
    Then only connection commands change it
    And the legacy string columns are derived, no longer written

  @unit
  Scenario: Backoffice edits go through commands like everyone else's
    Given an ops user editing a connection in the backoffice
    When they change the connection
    Then the change is a guarded command with the actor recorded
    And no raw table edit exists on the surface
