Feature: The identifier-first sign-in router - one front door, routed by data
  As a person signing in to LangWatch
  I need my email to route me to the right identity provider or method set
  So that every sign-in method works through one door, without the screen
  ever revealing whether an account exists for the address I typed

  # D03 (ADR-117). The router is a pure decision engine over Postgres reads;
  # user-level resolution (any verified email, OAuth subject) is the
  # ADR-116 storage adapter's job, so the router carries no per-user fork.
  #
  #   input                        decision                  reason code
  #   (self-hosted, 1 ACTIVE  →    redirect to the IdP       sole_active_connection
  #    connection, no email)
  #   (?local=1)              →    local method picker       break_glass
  #   email → normalize       →    domain in ACTIVE conn?
  #     yes                   →    redirect to the IdP       domain_routed
  #     no                    →    uniform method picker     no_domain_match
  #
  # The decision carries a reason code; the same codes drive the screens'
  # deny/guidance states (D13) and the ops surface's routing view (D05).
  # Domain lookup reads ssoDomain strings until D04's SsoConnection
  # projection takes over behind SSOCONN_ROUTING. The whole deliverable
  # flips with D13 on IDENTITY_ROUTER_V2, shadow-compared first.

  Background:
    Given an installation with the identifier-first router available behind its flag

  # ── Routing decisions ──────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: An email on an SSO domain routes to that connection's provider
    Given "acme.com" belongs to an ACTIVE SSO connection
    When "Sam.J+news@Acme.com" is submitted to the router
    Then the decision is a redirect to that connection's identity provider
    And the value was normalized exactly as attach-time normalization does
    And the decision carries the reason code "domain_routed"

  @unit @unimplemented
  Scenario: An email with no domain match offers the uniform method picker
    Given "home.net" belongs to no ACTIVE connection
    When "sam@home.net" is submitted to the router
    Then the decision is the instance's default method set
    And the decision carries the reason code "no_domain_match"

  @unit @unimplemented
  Scenario: The decision never depends on whether an account exists
    Given "home.net" belongs to no ACTIVE connection
    When an email with an account and an email without one are submitted
    Then both decisions are the same decision, field for field
    And nothing in either response names the account's existence

  @unit @unimplemented
  Scenario: A suspended connection stops routing its domain
    Given "acme.com" belongs to a connection in state SUSPENDED
    When "sam@acme.com" is submitted to the router
    Then the decision is the method picker, not a redirect
    And the decision carries a reason code the guidance screens can name

  @unit @unimplemented
  Scenario: Every routing decision is logged with its reason
    When any email is submitted to the router
    Then the decision and its reason code are logged
    And the log carries the domain, never the local part of the address

  # ── Self-hosted priority ───────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A sole ACTIVE connection auto-redirects before any email is asked
    Given a self-hosted installation with exactly one ACTIVE connection
    When the sign-in page is requested
    Then the decision is an immediate redirect to that identity provider
    And the decision carries the reason code "sole_active_connection"

  @unit @unimplemented
  Scenario: The break-glass path always reaches a local sign-in
    Given a self-hosted installation with exactly one ACTIVE connection
    When the sign-in page is requested with the break-glass parameter
    Then the decision is the local method set and no redirect happens
    And the break-glass sign-in is audited and rate-limited

  @unit @unimplemented
  Scenario: The provider env becomes the default method set
    Given a self-hosted installation configured with a single OAuth provider
    And the identifier-first router is enforced
    When the sign-in page is requested
    Then the configured provider is the offered method, exactly as before
    And a second method can be added without ending the first

  # ── The license gate rides along (ADR-027, mechanism amended) ──────────

  @unit @unimplemented
  Scenario: A never-licensed installation offers no federated method
    Given a self-hosted installation whose license gate denies
    When the sign-in page is requested
    Then no SSO method appears in any routing decision
    And the email and password method set is offered
    And a direct request to an SSO callback path is still refused

  @unit @unimplemented
  Scenario: The license gate still freezes at startup
    Given the license gate resolved at startup
    When a license is activated mid-process
    Then routing decisions do not change until the next restart

  # ── Callback linking ───────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A known provider subject signs straight in
    Given a user whose identifier matches the callback's connection and subject
    When the SSO callback completes
    Then the user is signed in
    And no link is created and no event is emitted

  @unit @unimplemented
  Scenario: An unambiguous verified match is auto-linked with an audit trail
    Given a callback asserting a verified email that exactly one user holds as a VERIFIED identifier
    And that user's identifiers raise no ambiguity
    When the SSO callback completes
    Then the identifier is attached through the pipeline and the user signs in
    And before and after audit events record the link

  @unit @unimplemented
  Scenario: An unverified orphan is never auto-linked
    Given a user row holding the callback's email without any verification evidence
    When the SSO callback completes
    Then no link is created
    And a link proposal is recorded for an admin to confirm
    And the sign-in is refused with guidance

  @unit @unimplemented
  Scenario: An ambiguous match becomes a proposal, not a guess
    Given the callback's verified email matches a user with identifiers the organization cannot vouch for
    When the SSO callback completes
    Then a LinkProposed event is recorded and the sign-in is refused with guidance
    And confirming the proposal later attaches the identifier and admits the user

  @unit @unimplemented
  Scenario: No match provisions just-in-time only where the connection allows
    Given a callback subject and email matching no user
    When the SSO callback completes on a connection that allows JIT
    Then a user is provisioned and signed in
    But on a connection that forbids JIT the sign-in is refused
    And the refusal carries the reason code "jit_disabled"

  # ── Cutover ────────────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Shadow mode compares every login and changes nothing
    Given the router flag is in shadow
    When a user signs in through the legacy path
    Then the router's decision is computed and compared against the legacy outcome
    And a mismatch is logged with both decisions and the reason code
    And the user's sign-in is untouched either way

  @unit @unimplemented
  Scenario: The flag off restores the legacy path entirely
    Given the router flag is enforced and then turned off
    When the sign-in page is requested
    Then the legacy path answers exactly as before the flip

  @integration @unimplemented
  Scenario: The pending SSO setup flag is reconciled once and retired
    Given users carrying the legacy pending-SSO-setup flag
    When the reconciliation runs
    Then each user's state is re-derived from their identifier data
    And the column is dropped once nothing reads it
