Feature: Authentication reads are remembered briefly and never past a revocation
  # Every signed-in request and every API-key call asked Postgres the same questions again:
  # the person behind the session, every organization's session rule, the key's row and its
  # project. These scenarios hold what is remembered, for how long, and what is never
  # remembered at all.

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

  Rule: an API key is looked up once per short window, and a wrong secret never rides it

    @unit
    Scenario: Repeated calls with one key read storage once
      Given a valid key
      When it makes ten calls within five seconds
      Then its row, its grants and its project are read once

    @unit
    Scenario: A revoked key is refused within five seconds
      Given a key whose answer is remembered
      When the key is revoked
      Then it is refused once five seconds have passed

    @unit
    Scenario: A wrong secret is refused while the right one is remembered
      Given a valid key whose answer is remembered
      When a caller presents the same key id with another secret
      Then that caller is refused

    @unit
    Scenario: An unknown key is remembered as unknown for a moment only
      Given a token that matches no key
      When it is presented twice at once and again after two seconds
      Then storage is asked once for the first pair and again after two seconds

    @unit
    Scenario: A key past its expiry is refused even while remembered
      Given a key that expires in two seconds and whose answer is remembered
      When three seconds pass
      Then it is refused

    @unit
    Scenario: Two keys never share a remembered answer
      Given two keys of different organizations are both remembered
      Then each call resolves its own organization

  Rule: one request asks each authorization question once

    @unit
    Scenario: A batch asking the same permission decides it once
      Given a batched request whose three procedures each need the same permission on one project
      When it is served
      Then authorization is asked once

    @unit
    Scenario: Two requests never share a decision
      Given one request was allowed
      When the permission is removed before the next request
      Then the next request is refused
