Feature: Which organization takes my address - matching rules and what they reveal
  As a person signing up with a work email
  I need LangWatch to find the organization my colleagues are in
  So that I can ask to join it, without that lookup turning into a way to
  find out who works where

  # D12 (ADR-117; the lifecycle is specs/identity/join-requests.feature, the
  # automatic path specs/identity/domain-auto-join.feature). Matching answers
  # exactly one question - "which organizations will take this address" - and
  # the answer is the most dangerous thing in this deliverable, because a
  # lookup that answers freely is a directory of who works where.
  #
  #   address ──not verified yet──────────────► nothing, ever
  #           ──public email domain───────────► nothing, structurally
  #           ──verified, domain d────────────► organizations where
  #                                              · at least one member holds a
  #                                                VERIFIED address on d
  #                                              · the organization is not a
  #                                                personal one
  #                                              · no ACTIVE SSO connection
  #                                                admits people already
  #                                              · joining is not turned off
  #
  # Everything outside that funnel answers with the same nothing. "No such
  # organization", "closed to you" and "you have not verified yet" are one
  # answer, because telling them apart is the leak.
  #
  # DECISION - the matching threshold (epic Open Q8, settled here). Asking to
  # join needs ONE member holding a verified address on the domain: the ask
  # reveals nothing on its own and an admin gates the outcome. Walking in
  # automatically needs more, because nobody gates it - the administrator must
  # have named that domain themselves when they turned automatic joining on,
  # AND two members must hold verified addresses on it. One colleague with a
  # personal-looking address at a small vendor is not evidence a company owns
  # a domain; the administrator saying so, plus corroboration, is.
  #
  # Ships behind JOIN_REQUESTS.

  Background:
    Given "sam" is signing up with "sam@acme.com"
    And an organization "acme" whose members hold verified addresses on "acme.com"
    And "acme" accepts requests to join from that domain

  # ── What matches ───────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A verified work address finds the organization its colleagues are in
    Given "sam" has verified "sam@acme.com"
    When the organizations open to that address are looked up
    Then "acme" is offered
    And nothing else about "acme" beyond its name and a colleague count is returned

  @unit @unimplemented
  Scenario: One verified colleague on the domain is enough to ask
    Given exactly one member of "acme" holds a verified address on "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is offered as somewhere to ask to join

  @unit @unimplemented
  Scenario: Only verified addresses count as evidence
    Given every "acme.com" address its members hold is unverified
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is not offered
    And the answer is the same one an address with no colleagues anywhere gets

  @unit @unimplemented
  Scenario: The address is compared the way it is compared everywhere else
    When "Sam.J+news@Acme.com" is looked up
    Then the domain it is matched on is the one attach-time normalization produces
    And "sam@mail.acme.com" and "sam@acme.com.example" match nothing "acme.com" matches

  @unit @unimplemented
  Scenario: Two organizations on one domain are both offered to ask
    Given a second organization also holds verified members on "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then both are offered
    And "sam" chooses which one to ask

  # ── What never matches ─────────────────────────────────────────────────

  # A public email domain is not a company. This has to be impossible rather
  # than unlikely: one match on a consumer mail provider would offer strangers
  # to each other by the million.

  @unit @unimplemented
  Scenario: A public email domain matches nothing, in any mode
    Given "sam" verified a consumer mail address instead
    When the organizations open to it are looked up
    Then nothing is offered
    And this holds whether an organization on that domain asks for requests or automatic joining

  @unit @unimplemented
  Scenario: Personal organizations are never offered to anybody
    Given a colleague's personal organization holds a verified "acme.com" address
    When the organizations open to "sam@acme.com" are looked up
    Then the personal organization is not among them

  @unit @unimplemented
  Scenario: An organization whose identity provider already admits people is not offered
    Given "acme" has an ACTIVE SSO connection for "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is not offered
    And "sam" reaches "acme" by signing in through its identity provider instead

  @unit @unimplemented
  Scenario: An organization that turned joining off is invisible, not refused
    Given "acme" has turned joining off
    When the organizations open to "sam@acme.com" are looked up
    Then nothing is offered
    And the answer is identical, field for field, to the answer for a domain no organization holds

  # ── Reveal discipline ──────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: Nothing is revealed before the address is verified
    Given "sam" has typed "sam@acme.com" but has not verified it
    When the organizations open to that address are looked up
    Then nothing is offered
    And no name, count or hint about "acme" appears anywhere in the answer

  @unit @unimplemented
  Scenario: The colleague count is coarse and never a list
    Given "acme" has one hundred and seventeen members
    When "acme" is offered to "sam"
    Then the count shown is a rounded one, not the exact number
    And no member's name, address or role is returned

  @unit @unimplemented
  Scenario: Refusing to offer never says why
    Given three addresses: one on a domain nobody holds, one on a domain whose
      organization turned joining off, and one nobody has verified yet
    When each is looked up
    Then all three answers are the same answer, field for field
    And a refusal to act on one carries code join_not_available and status 404

  @unit @unimplemented
  Scenario: The lookup is rate limited and logged without the person in it
    When the same visitor looks addresses up faster than the installation allows
    Then further lookups are refused with code join_request_throttled and status 429
    And each lookup is logged with the domain and the decision, never the local part of the address

  @unit @unimplemented
  Scenario: Asking for an organization that was never offered is refused as if it did not exist
    Given "acme" was not offered to "sam" for any reason
    When "sam" asks to join "acme" by naming it directly
    Then the attempt is refused with code join_not_available and status 404
    And the refusal is the same one an organization that does not exist produces
