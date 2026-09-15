Feature: Per-key rate limiting is observable
  As an operator running LangWatch
  I want a rate limit being hit to leave an operational signal
  So that a spam-create or credential-stuffing run against an auth mutation is
  visible without grepping per-request logs

  # `rateLimit()` (`src/server/rateLimit.ts`) guards tRPC mutations that write
  # straight to the database and skip BetterAuth's own per-route limiter (e.g.
  # `user.register`, which does not go through `/api/auth/sign-up/email`). A
  # denial already changes the caller's own response; without a counter, an
  # attacker hammering one endpoint from a botnet of addresses and a genuine
  # limit never firing look identical from the outside — both are silent.
  #
  # `scope` is the segment of the key before its first ":" (keys look like
  # `auth.route:addr:<sha256>`) — the caller that chose the limit, never the
  # address or hash that follows it, so the label stays low-cardinality.

  Rule: A denial increments the counter, an allow does not

    @unit
    Scenario: An allowed call leaves the counter unmoved
      Given a rate limit with requests still under its window's max
      When a call is checked against it
      Then the call is allowed
      And the rate-limit-exceeded counter does not move

    @unit
    Scenario: A denied call increments the counter for its scope
      Given a rate limit already at its window's max
      When another call is checked against it
      Then the call is denied
      And the rate-limit-exceeded counter increments for the key's scope

    @unit
    Scenario: The Redis-backed path counts denials the same way as the in-memory path
      Given Redis answers a count already over the window's max
      When a call is checked against the rate limit
      Then the call is denied
      And the rate-limit-exceeded counter increments for the key's scope

  Rule: Asking for a confirmation link has a budget, per caller and per address

    # The one endpoint a signed-out visitor can use to make us send mail to an
    # address they have not proved they hold. Two budgets, because the two
    # abuses are different shapes: a script working through a list of
    # addresses, and any number of callers turning one stranger's
    # half-finished sign-up into a way to mail that stranger over and over.
    # Both refusals stop before the mail is attempted, which is the part that
    # costs somebody else something.

    @unit
    Scenario: Asking again and again for a confirmation link stops being answered
      Given a visitor asking for a confirmation link for a different address every time
      When that visitor's budget for the hour is spent
      Then the next request is refused and says how long to wait
      And no further mail is attempted for it

    @unit
    Scenario: A stranger's address cannot be mail-bombed through sign-up
      Given the same unconfirmed address is asked for from a new client each time
      When that address's budget for the hour is spent
      Then the next request for it is refused and says how long to wait
      And no further mail is attempted for that address
