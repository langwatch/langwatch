Feature: Authentication reads are remembered briefly and never past a revocation
  # Every signed-in request asked Postgres the same questions again:
  # the person behind the session and every organization's session rule. These scenarios
  # hold what is remembered, for how long, and what is never remembered at all.

  Rule: a session is read from its own row on every request

    @unit
    Scenario: Repeated reads of one session ask for the person and the rules once
      Given "sam" is signed in
      When his browser makes ten requests within thirty seconds
      Then his session row is read ten times
      And his stored details and the organization session rules are read once

    @unit
    Scenario: An ended session is refused on the next request, whatever is remembered
      Given "sam"'s details are remembered from an earlier request
      When his session row is deleted
      Then his next request resolves nobody

    @unit
    Scenario: A saved session window sweeps with fresh rules
      Given the organization rules were remembered with no window set
      When an administrator saves an idle window
      Then the sweep that follows reads the rules again and ends the idle sessions

    @unit
    Scenario: One person's remembered details never answer for another
      Given "sam"'s details are remembered
      When "kim" is signed in on another browser
      Then her session carries her own address, never his

  # An API key's check moved to modules/api-key/specs/auth-check-cache.feature (Alex, 2026-10-01).

  Rule: one request asks each authorization question once

    @unit
    Scenario: A request decides its permission once
      Given a request whose procedure needs a permission on one project
      When it is served
      Then authorization is asked once

    @unit
    Scenario: Two requests never share a decision
      Given one request was allowed
      When the permission is removed before the next request
      Then the next request is refused
