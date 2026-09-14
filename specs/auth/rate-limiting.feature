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
