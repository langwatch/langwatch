Feature: The identifier-first sign-in router - one auth screen, routed by data
  As a person signing in to LangWatch
  I need my email to route me to the right identity provider or method set
  So that every sign-in method works through one door and credential failures
  never reveal whether the address or secret was wrong

  # D03 (ADR-117). The router is a pure decision engine over Postgres reads;
  # user-level resolution (any verified email, OAuth subject) is the
  # ADR-116 storage adapter's job. The router consumes the account method
  # answer through its lookup port; it does not read identity storage itself.
  #
  #   input                        decision                  reason code
  #   (self-hosted, 1 ACTIVE  →    redirect to the IdP       sole_active_connection
  #    connection, no email)
  #   (?local=1)              →    local method picker       break_glass
  #   email → normalize       →    domain in ACTIVE conn?
  #     yes                   →    redirect to the IdP       domain_routed
  #     no, known account     →    account's method picker   account_methods
  #     no, unknown account   →    continue to sign-up       identifier_unknown
  #     lookup not wired      →    default method picker     no_domain_match
  #
  # The decision carries a reason code; the same codes drive the screens'
  # deny/guidance states (D13) and the ops surface's routing view (D05).
  # Domain lookup reads ssoDomain strings until D04's SsoConnection
  # projection takes over behind SSOCONN_ROUTING. The whole deliverable
  # ships with D13: the router decides, and the screens render what it decided.

  Background:
    Given an installation with the identifier-first router

  # ── Routing decisions ──────────────────────────────────────────────────

  @unit
  Scenario: An email on an SSO domain routes to that connection's provider
    Given "acme.com" belongs to an ACTIVE SSO connection
    When "Sam.J+news@Acme.com" is submitted to the router
    Then the decision is a redirect to that connection's identity provider
    And the value was normalized exactly as attach-time normalization does
    And the decision carries the reason code "domain_routed"

  # RETIRED, and replaced by the four scenarios below (ADR-117, revision
  # 2026-08-25). The router used to answer a known address and an unknown one
  # identically, by construction. It no longer does, and the argument is in
  # the ADR: the sign-up door already answers "does this address have an
  # account" to anybody who asks, so the router's silence bought nothing an
  # attacker could not get next door — and it cost every real customer a
  # password box in front of a passkey-only account, or in front of no
  # account at all. What survives is named below: one credential refusal, one
  # rate limit, and no secret ever read.

  @unit
  Scenario: A router that was never asked about accounts answers as it always did
    Given "home.net" belongs to no ACTIVE connection
    And this deployment never wired the account lookup
    When "sam@home.net" is submitted to the router
    Then the decision is the instance's default method set
    And the decision carries the reason code "no_domain_match"

  @unit
  Scenario: An address with no account carries on as a sign-up
    Given "home.net" belongs to no ACTIVE connection
    And no account holds "nobody@home.net"
    When "nobody@home.net" is submitted to the router
    Then the decision routes to sign-up with the reason code "identifier_unknown"
    And the decision offers no method at all
    And the routing log records the domain and never the address

  @unit
  Scenario: An account the sign-up form just made is not mistaken for no account
    Given "home.net" belongs to no ACTIVE connection
    And somebody registers "new@home.net" through the sign-up form
    When "new@home.net" is submitted to the router
    Then the decision offers the password
    And the decision never routes to sign-up with the reason code "identifier_unknown"

  @unit
  Scenario: An account still waiting for identifier backfill keeps its way in
    Given "home.net" belongs to no ACTIVE connection
    And an existing account holds "legacy@home.net"
    And that account's identifier backfill is not finalized
    When "legacy@home.net" is submitted to the router
    Then the decision offers the account's legacy sign-in method
    And the decision never routes to sign-up with the reason code "identifier_unknown"

  @unit
  Scenario: The methods offered are the ones that account holds
    Given "home.net" belongs to no ACTIVE connection
    And the account for "sam@home.net" holds a passkey and no password
    When "sam@home.net" is submitted to the router
    Then the decision offers the passkey and not the password
    And the methods are ordered strongest first
    And a method this deployment does not offer is never offered

  @unit
  Scenario: A connected domain routes before the account is consulted
    Given "acme.com" belongs to a connection in state ACTIVE
    And no account holds "newhire@acme.com"
    When "newhire@acme.com" is submitted to the router
    Then the decision redirects to that connection's identity provider
    And the account is never looked up

  @unit
  Scenario: An account whose every method was turned off still gets a way in
    Given "home.net" belongs to no ACTIVE connection
    And the account for "sam@home.net" holds only a method this deployment stopped offering
    When "sam@home.net" is submitted to the router
    Then the decision is the instance's default method set
    And the decision is not a sign-up

  # The half of the no-oracle that is NOT retired, and the reason the retirement
  # is safe. Knowing an account exists is now cheap; knowing which half of a
  # submitted pair was wrong is what turns credential stuffing from guessing
  # pairs into guessing one field at a time, and that is still never told.
  @unit
  Scenario: A refused credential still refuses in one way
    Given an account holds "sam@home.net"
    When a wrong password for it and a password for an address nobody holds are submitted
    Then both are refused with the code "identity_sign_in_refused"
    And neither refusal says which half was wrong

  @unit
  Scenario: A suspended connection stops routing its domain
    Given "acme.com" belongs to a connection in state SUSPENDED
    When "sam@acme.com" is submitted to the router
    Then the decision is the method picker, not a redirect
    And the decision carries a reason code the guidance screens can name

  @unit
  Scenario: Every routing decision is logged with its reason
    When any email is submitted to the router
    Then the decision and its reason code are logged
    And the log carries the domain, never the local part of the address

  @unit
  Scenario: Auth throttles distinguish callers behind a trusted ingress
    Given two callers reach the auth screen through the same configured trusted proxy
    When each caller asks the sign-in router where an address should go
    Then each caller spends a separate per-client budget
    And a forwarding header received from an untrusted peer is ignored

  @unit
  Scenario: A caller on the public internet cannot choose its own throttle bucket
    Given no trusted proxy is configured
    And the caller reaches the app directly from a public address
    When the caller sends a forwarding header naming a different address
    Then the forwarding header is ignored
    And the budget is spent against the address the caller connected from

  @unit
  Scenario: An in-cluster ingress does not collapse every visitor into one bucket
    Given no trusted proxy is configured
    And the app is reached through an ingress on a private address
    When two visitors ask the sign-in router where an address should go
    Then the ingress is read as the deployment's own hop
    And each visitor spends a separate per-client budget

  @unit
  Scenario: Better Auth counts the same caller the platform counts
    Given a request reaches an endpoint Better Auth throttles for itself
    When the caller has been resolved from the connection
    Then Better Auth is handed that caller as the canonical forwarding header
    And no header written by the caller reaches its throttle

  # ── Self-hosted priority ───────────────────────────────────────────────

  @unit
  Scenario: A sole ACTIVE connection auto-redirects before any email is asked
    Given a self-hosted installation with exactly one ACTIVE connection
    When the sign-in page is requested
    Then the decision is an immediate redirect to that identity provider
    And the decision carries the reason code "sole_active_connection"

  @unit
  Scenario: The break-glass path always reaches a local sign-in
    Given a self-hosted installation with exactly one ACTIVE connection
    When the sign-in page is requested with the break-glass parameter
    Then the decision is the local method set and no redirect happens
    And the break-glass sign-in is audited and rate-limited

  @unit
  Scenario: The provider env becomes the default method set
    Given a self-hosted installation configured with a single OAuth provider
    When the sign-in page is requested
    Then the configured provider is the offered method, exactly as before
    And a second method can be added without ending the first

  # ── The license gate rides along (ADR-027, mechanism amended) ──────────

  @unit
  Scenario: A never-licensed installation offers no federated method
    Given a self-hosted installation whose license gate denies
    When the sign-in page is requested
    Then no SSO method appears in any routing decision
    And the email and password method set is offered
    And a direct request to an SSO callback path is still refused

  @unit
  Scenario: The license gate still freezes at startup
    Given the license gate resolved at startup
    When a license is activated mid-process
    Then routing decisions do not change until the next restart

  # ── Callback linking ───────────────────────────────────────────────────

  @unit
  Scenario: A known provider subject signs straight in
    Given a user whose identifier matches the callback's connection and subject
    When the SSO callback completes
    Then the user is signed in
    And no link is created and no event is emitted

  @unit
  Scenario: An unambiguous verified match is auto-linked with an audit trail
    Given a callback asserting a verified email that exactly one user holds as a VERIFIED identifier
    And that user's identifiers raise no ambiguity
    When the SSO callback completes
    Then the identifier is attached through the pipeline and the user signs in
    And before and after audit events record the link

  @unit
  Scenario: An unverified orphan is never auto-linked
    Given a user row holding the callback's email without any verification evidence
    When the SSO callback completes
    Then no link is created
    And a link proposal is recorded for an admin to confirm
    And the sign-in is refused with guidance

  @unit
  Scenario: An ambiguous match becomes a proposal, not a guess
    Given the callback's verified email matches a user with identifiers the organization cannot vouch for
    When the SSO callback completes
    Then a LinkProposed event is recorded and the sign-in is refused with guidance
    And confirming the proposal later attaches the identifier and admits the user

  # WHERE THE RULE ABOVE ACTUALLY RUNS.
  #
  # The four scenarios above describe the callback service that owns the whole
  # decision: resolve the person, then link, propose or provision. On every
  # deployment we run, the identity library owns that resolution instead, and
  # the only moment it offers before a sign-in method exists is one where the
  # link has already been chosen. So the same rule is applied there, from the
  # one shared refusal function, and these two scenarios bind THAT — a
  # scenario bound only to the service above would be bound to code no
  # deployment reaches.
  #
  # It judges an addition to an account that already signs in some way. A
  # person with no sign-in method yet is covered by
  # specs/auth/sso-orphan-user-linking.feature, which binds the same question
  # against a real callback.

  @unit
  Scenario: The evidence rule also guards a method added to an established account
    Given somebody who already signs in one way
    And a second method whose identity provider says the address is not verified
    When that method would be attached to their account
    Then the attachment is refused and nothing is attached
    And a link proposal is recorded for an admin to confirm

  @unit
  Scenario: An identity provider that asserts nothing refuses nothing
    Given a second method whose identity provider makes no claim about the address
    When that method would be attached to an established account
    Then it is attached exactly as it was before this rule existed

  @unit
  Scenario: No match provisions just-in-time only where the connection allows
    Given a callback subject and email matching no user
    When the SSO callback completes on a connection that allows JIT
    Then a user is provisioned and signed in
    But on a connection that forbids JIT the sign-in is refused
    And the refusal carries the reason code "jit_disabled"

  @integration @unimplemented
  Scenario: The pending SSO setup flag is reconciled once and retired
    Given users carrying the legacy pending-SSO-setup flag
    When the reconciliation runs
    Then each user's state is re-derived from their identifier data
    And the column is dropped once nothing reads it
