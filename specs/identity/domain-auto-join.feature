Feature: Domain auto-join - walking straight in, where the organization asked for it
  As an organization that has decided anybody with a company address belongs
  I need a verified colleague to land inside without an admin clicking
  So that onboarding is not a queue, while every automatic join stays visible,
  reversible and impossible on an address that proves nothing

  # D12 (ADR-117; lifecycle in specs/identity/join-requests.feature, matching
  # and reveal rules in specs/identity/join-matching-and-privacy.feature).
  #
  # Automatic joining is NOT a second mechanism. It is the same request, the
  # same events, the same panel and the same audit trail - approved by policy
  # the moment it is made instead of by a person later:
  #
  #   request made ──► PENDING ──policy approves at once──► APPROVED
  #                                                          │
  #                                    admins told AFTER the fact, immediately
  #
  # That equivalence is the point. A surprising join looks exactly like a
  # surprising approval on the audit page, and turning the setting off does
  # not leave a class of membership nobody can account for.
  #
  # Three settings, one per organization: joining OFF, joining BY REQUEST
  # (the default for self-serve organizations), joining AUTOMATIC. Automatic
  # is never a default and never inferred - an administrator turns it on and
  # names the domain while doing it.
  #
  # LICENSING - a deliberate asymmetry (this file settles it, and
  # specs/licensing/sso-license-gating.feature carries the matching
  # vocabulary). Automatic joining is federation: the deployment decides who
  # is a colleague and admits them with nobody in the loop, which is what that
  # gate has always counted as single sign-on. Asking to join is not - an
  # administrator approves every one, no identity provider is involved, and
  # gating it would recreate "my company is invisible" on exactly the
  # deployments that have no other way out. So the gate holds automatic
  # joining and lets requests through.
  #
  # Ships behind JOIN_REQUESTS.

  Background:
    Given an organization "acme" with an administrator "ana"
    And two members of "acme" hold verified addresses on "acme.com"
    And "sam" holds a VERIFIED identifier for "sam@acme.com" and belongs to no organization

  # ── Walking in ─────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A verified colleague joins an opted-in organization immediately
    Given "ana" turned on automatic joining for "acme.com"
    When "sam" completes sign-up and verification
    Then "sam" is a member of "acme" with the organization's default role
    And "sam" was never shown a waiting screen

  @unit @unimplemented
  Scenario: The automatic path is the same lifecycle, approved by policy
    Given "ana" turned on automatic joining for "acme.com"
    When "sam" joins automatically
    Then a request was made and immediately approved
    And it records the policy, not a person, as what resolved it
    And it sits in the same panel and the same history as an admin approval

  @integration @unimplemented
  Scenario: The admins are told after the fact, straight away
    Given "ana" turned on automatic joining for "acme.com"
    When "sam" joins automatically
    Then every admin of "acme" is told it happened, by email and in the product
    And the message names who joined and that the domain setting admitted them

  @integration @unimplemented
  Scenario: Every automatic join is on the customer's audit page
    Given "ana" turned on automatic joining for "acme.com"
    When "sam" joins automatically
    Then "acme"'s audit page shows the membership with the policy as what authorized it
    And it is no harder to find than a membership an admin approved by hand

  @unit @unimplemented
  Scenario: Walking in still grants only the default role
    Given "ana" turned on automatic joining for "acme.com"
    When "sam" joins automatically
    Then "sam" holds the organization's default role and nothing more

  # ── Turning it on is deliberate ────────────────────────────────────────

  @unit @unimplemented
  Scenario: Asking is the default and automatic is never inferred
    Given a newly created self-serve organization
    When its joining setting is read
    Then colleagues may ask to join
    And nobody joins automatically until an administrator turns that on

  @unit @unimplemented
  Scenario: Turning it on names the domain and needs corroboration
    Given only one member of "acme" holds a verified address on "acme.com"
    When "ana" turns on automatic joining for "acme.com"
    Then the attempt is refused with code join_auto_domain_unproven and status 422
    And it succeeds once a second member holds a verified address on that domain

  @unit @unimplemented
  Scenario: A public email domain cannot be turned on at all
    When "ana" turns on automatic joining for a consumer mail domain
    Then the attempt is refused with code join_auto_domain_unproven and status 422
    And the refusal says company domains only, without listing the deny-list

  @unit @unimplemented
  Scenario: An organization whose identity provider admits people cannot turn it on
    Given "acme" has an ACTIVE SSO connection for "acme.com"
    When "ana" turns on automatic joining
    Then the attempt is refused with code join_auto_connection_admits and status 409
    And the refusal points at the connection's own provisioning as the way in

  @unit @unimplemented
  Scenario: Turning it off stops future joins and touches nobody already in
    Given "acme" has automatic joining on and members who arrived that way
    When "ana" turns it back to asking
    Then the next verified colleague waits for an approval
    And everybody who already joined stays a member with the role they hold

  # ── Only an administrator, only a person ───────────────────────────────

  @unit @unimplemented
  Scenario: Changing the setting needs the authority that gates managing the organization
    Given a member of "acme" who cannot manage the organization
    When they try to change the joining setting
    Then the attempt is refused for lack of permission

  @unit @unimplemented
  Scenario: The setting change is itself audited
    When "ana" changes "acme"'s joining setting
    Then the change is on "acme"'s audit page with "ana" as the actor and both values

  # ── The license line ───────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: An unlicensed deployment cannot turn automatic joining on
    Given a self-hosted deployment that has never held a genuine license
    When "ana" turns on automatic joining for "acme.com"
    Then the attempt is refused with code join_auto_not_licensed and status 403
    And "acme" stays on asking

  @unit @unimplemented
  Scenario: An unlicensed deployment still lets colleagues ask
    Given a self-hosted deployment that has never held a genuine license
    And "acme" accepts requests to join from "acme.com"
    When "sam" asks to join "acme"
    Then the request is PENDING and the admins are told
    And approving it makes "sam" a member
    And nothing on that path consulted the license at all

  @unit @unimplemented
  Scenario: Losing the license stops automatic joining without stranding members
    Given "acme" has automatic joining on under a genuine license
    When the deployment restarts without one
    Then the next verified colleague waits for an approval instead
    And everybody who already joined stays a member

  # ── Refusing to guess ──────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: An ambiguous domain refuses to admit and falls back to asking
    Given two organizations both hold verified members on "acme.com"
    And both have automatic joining on
    When "sam" completes verification
    Then "sam" joins neither automatically
    And both are offered as somewhere to ask, and "sam" chooses

  @unit @unimplemented
  Scenario: An unverified address never walks in
    Given "acme" has automatic joining on for "acme.com"
    And "sam" has typed the address but not verified it
    When sign-up continues
    Then "sam" is not a member of anything
    And verifying the address is what admits them

  @unit @unimplemented
  Scenario: With the flag off nobody joins automatically
    Given the join-requests flag is off
    And "acme" carries an automatic joining setting from a previous bake
    When "sam" completes sign-up and verification
    Then "sam" joins nothing and sign-up proceeds as it did before
