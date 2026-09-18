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
  #                                              · no ACTIVE SSO connection
  #                                                admits people already
  #                                              · joining is not turned off
  #
  # Everything outside that funnel answers with the same nothing. "No such
  # organization", "closed to you" and "you have not verified yet" are one
  # answer, because telling them apart is the leak.
  #
  # DECISION - the personal-organization exclusion is SUBSUMED, not dropped.
  # This file used to require that personal organizations are never offered.
  # There is no such thing in this schema: `Team.isPersonal` and
  # `Project.isPersonal` mark a per-member workspace INSIDE an organization,
  # and every organization the product creates is given a shared team, so a
  # predicate for it is permanently false - a scenario that reads green while
  # proving nothing. The privacy it was reaching for is held by the rules
  # above instead: a consumer domain is structurally excluded, automatic
  # joining needs an admin-named domain AND a proof the organization controls
  # it (which no count of signed-up addresses can fake), and the request path
  # ends with an administrator free to ignore it. What remains is the solo WORK organization, and offering that is
  # the orphan-organization fix doing its job rather than a leak - the asker
  # learns only that somebody at a domain they have already proved they hold
  # uses LangWatch, and the person there decides. The scenario below states
  # that outcome instead.
  #
  # DECISION - the matching threshold (epic Open Q8, settled here; evidence
  # basis revised 2026-08-25). Asking to join needs ONE member holding a
  # verified address on the domain: the ask reveals nothing on its own and an
  # admin gates the outcome. Walking in automatically needs a PROOF the
  # organization controls the domain - the verification ceremony's published
  # record or file, an operator's attestation, or a licence - because nobody
  # gates that path. Members' verified addresses are deliberately not enough
  # for it, however many there are: any two accounts on a consumer mail host
  # the deny-list has not heard of can receive mail on a domain, and only
  # whoever controls the domain can prove it.
  #
  # On for everybody: the JOIN_REQUESTS flag is retired (see
  # specs/identity/join-requests.feature).

  Background:
    Given "sam" is signing up with "sam@acme.com"
    And an organization "acme" whose members hold verified addresses on "acme.com"
    And "acme" accepts requests to join from that domain

  # ── What matches ───────────────────────────────────────────────────────

  @unit
  Scenario: A verified work address finds the organization its colleagues are in
    Given "sam" has verified "sam@acme.com"
    When the organizations open to that address are looked up
    Then "acme" is offered
    And nothing else about "acme" beyond its name and a colleague count is returned

  @unit
  Scenario: One verified colleague on the domain is enough to ask
    Given exactly one member of "acme" holds a verified address on "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is offered as somewhere to ask to join

  @unit
  Scenario: Only verified addresses count as evidence
    Given every "acme.com" address its members hold is unverified
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is not offered
    And the answer is the same one an address with no colleagues anywhere gets

  @unit
  Scenario: The address is compared the way it is compared everywhere else
    When "Sam.J+news@Acme.com" is looked up
    Then the domain it is matched on is the one attach-time normalization produces
    And "sam@mail.acme.com" and "sam@acme.com.example" match nothing "acme.com" matches

  @unit
  Scenario: Two organizations on one domain are both offered to ask
    Given a second organization also holds verified members on "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then both are offered
    And "sam" chooses which one to ask

  # ── What never matches ─────────────────────────────────────────────────

  # A public email domain is not a company. This has to be impossible rather
  # than unlikely: one match on a consumer mail provider would offer strangers
  # to each other by the million.

  @unit
  Scenario: A public email domain matches nothing, in any mode
    Given "sam" verified a consumer mail address instead
    When the organizations open to it are looked up
    Then nothing is offered
    And this holds whether an organization on that domain asks for requests or automatic joining

  @unit
  Scenario: A one-person organization is offered, because a person still decides
    Given "acme" has exactly one member, holding a verified "acme.com" address
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is among them
    And nobody joins it without that member approving
    And it cannot admit anybody automatically, whatever its setting says

  # BELONGING TO ONE ORGANIZATION IS NOT A REASON TO BE OFFERED NOTHING. A
  # contractor whose address matches two teams, or somebody whose company runs
  # a second organization, has a real reason to ask for the second one — and
  # the offer is the only way they will ever learn it is there. What is never
  # offered is the organization they are standing in: an "ask to join" beside
  # a workspace somebody is already using reads as the product not knowing who
  # they are, and asking could only ever be refused.
  @unit
  Scenario: An organization I am already in is not offered, and the others still are
    Given "sam" is a member of "acme" and not of "acme labs"
    And both hold verified "acme.com" addresses and allow joining
    When the organizations open to "sam@acme.com" are looked up
    Then "acme labs" is offered
    And "acme" is not offered
    And being in one organization never silences the offer of another

  @unit
  Scenario: An organization whose identity provider already admits people is not offered
    Given "acme" has an ACTIVE SSO connection for "acme.com"
    When the organizations open to "sam@acme.com" are looked up
    Then "acme" is not offered
    And "sam" reaches "acme" by signing in through its identity provider instead

  @unit
  Scenario: An organization that turned joining off is invisible, not refused
    Given "acme" has turned joining off
    When the organizations open to "sam@acme.com" are looked up
    Then nothing is offered
    And the answer is identical, field for field, to the answer for a domain no organization holds

  # ── Reveal discipline ──────────────────────────────────────────────────

  @unit
  Scenario: Nothing is revealed before the address is verified
    Given "sam" has typed "sam@acme.com" but has not verified it
    When the organizations open to that address are looked up
    Then nothing is offered
    And no name, count or hint about "acme" appears anywhere in the answer

  @unit
  Scenario: The colleague count is coarse and never a list
    Given "acme" has one hundred and seventeen members
    When "acme" is offered to "sam"
    Then the count shown is a rounded one, not the exact number
    And no member's name, address or role is returned

  @unit
  Scenario: Refusing to offer never says why
    Given three addresses: one on a domain nobody holds, one on a domain whose
      organization turned joining off, and one nobody has verified yet
    When each is looked up
    Then all three answers are the same answer, field for field
    And a refusal to act on one carries code join_not_available and status 404

  @unit
  Scenario: The lookup is rate limited and logged without the person in it
    When the same visitor looks addresses up faster than the installation allows
    Then further lookups are refused with code join_request_throttled and status 429
    And each lookup is logged with the domain and the decision, never the local part of the address

  @unit
  Scenario: Asking for an organization that was never offered is refused as if it did not exist
    Given "acme" was not offered to "sam" for any reason
    When "sam" asks to join "acme" by naming it directly
    Then the attempt is refused with code join_not_available and status 404
    And the refusal is the same one an organization that does not exist produces
