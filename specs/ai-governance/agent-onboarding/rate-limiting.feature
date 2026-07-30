Feature: Rate limiting the anonymous onboarding surface
  As the operator of a control plane with an unauthenticated account-minting
  endpoint
  I want every provisioning and claim call metered on several independent axes
  So that a single actor cannot farm accounts, brute-force a claim token, or
  push the reaper's storage bill up, while a first-time developer still sees
  zero friction.

  `/provision` creates rows in Postgres and a tenant in ClickHouse from an
  unauthenticated request. That is the most abusable shape an endpoint can
  have, so it is metered on four axes at once and the tightest one wins.

  Pairs with:
    - specs/ai-governance/agent-onboarding/provisioning.feature
    - specs/ai-governance/agent-onboarding/claim-handoff.feature

  Background:
    Given the RPC service is mounted at `/api/agent-onboarding`

  # ─────────────────────────────────────────────────────────────────────
  # The axes
  # ─────────────────────────────────────────────────────────────────────

  @bdd @ratelimit
  Scenario: provisioning is metered on four independent axes
    When a caller POSTs to `/provision`
    Then the request is counted against the per-fingerprint bucket
    And the request is counted against the per-IP bucket
    And the request is counted against the per-IP-subnet bucket
    And the request is counted against the global bucket

  @bdd @ratelimit
  Scenario Outline: each axis refuses once its own budget is spent
    Given the `<axis>` bucket for this caller is already at its limit
    When the caller POSTs to `/provision`
    Then the response is 429 with code `rate_limited`
    And the response names `<axis>` as the axis that tripped
    And the response carries a `Retry-After` header

    Examples:
      | axis        |
      | fingerprint |
      | ip          |
      | ip_subnet   |
      | global      |

  @bdd @ratelimit
  Scenario: the tightest axis decides, and the others are not consumed
    Given the per-fingerprint bucket is exhausted
    And the per-IP bucket has budget left
    When the caller POSTs to `/provision`
    Then the response is 429
    And the per-IP bucket is not decremented
    # short-circuiting keeps a blocked abuser from also burning the shared
    # IP budget of everyone behind the same NAT.

  @bdd @ratelimit
  Scenario: a refused request creates nothing
    Given any axis is exhausted
    When the caller POSTs to `/provision`
    Then no organization, team, project or ingestion key is created

  @bdd @ratelimit
  Scenario: the IP subnet axis groups v4 by /24 and v6 by /64
    Given a caller rotating through addresses inside one `/24`
    When they POST to `/provision` repeatedly
    Then every request lands in the same subnet bucket
    And a caller rotating inside one v6 `/64` lands in one bucket too
    # rotating the last octet, or being handed a fresh v6 address per
    # connection, is the cheapest possible evasion — group it away.

  @bdd @ratelimit @security
  Scenario: the client cannot pick its own IP
    Given the caller sends a forged `X-Forwarded-For` header
    When they POST to `/provision`
    Then the IP used for metering comes from the trusted proxy configuration
    And not from an arbitrary client-supplied header
    # otherwise every axis except fingerprint is one header away from useless.

  @bdd @ratelimit @security
  Scenario: a caller cannot escape the fingerprint axis by omitting it
    Given the caller sends no fingerprint
    When they POST to `/provision`
    Then the per-IP and subnet axes still apply
    And the missing fingerprint does not widen any other budget

  # ─────────────────────────────────────────────────────────────────────
  # Claim endpoints
  # ─────────────────────────────────────────────────────────────────────

  @bdd @ratelimit @claim
  Scenario: claim attempts are metered per IP
    Given a caller has made the maximum claim attempts from one IP
    When they POST to `/claim/handoff` again
    Then the response is 429 with code `rate_limited`

  @bdd @ratelimit @claim @security
  Scenario: a wrong claim token is metered harder than a right one
    When a caller submits an invalid claim token
    Then the failure is counted against a dedicated failed-claim bucket
    And exhausting that bucket refuses further attempts from the IP
    # claim tokens are 256-bit so guessing is hopeless on paper; the bucket
    # is there so trying anyway is not free.

  @bdd @ratelimit @claim @security
  Scenario: a token that does not resolve gets one answer, whatever the reason
    When a caller submits a claim token that never existed
    And another caller submits the token of an account already deleted
    Then both responses have the same code and the same message
    # a different answer per case turns the endpoint into an oracle for
    # "did an account with this token ever exist".

  @bdd @ratelimit @claim @security
  Scenario: a genuine token past its deadline is told the truth
    Given a caller holds a real claim token whose account passed `deleteAfter`
    When they claim it
    Then the response says the window has closed and the data is gone
    And that is deliberately distinguishable from an unknown token
    # holding a 256-bit token is itself proof of ownership — nobody reaches
    # this branch by guessing, so the only person who can see it is the
    # owner, and they deserve a real answer rather than "not available".

  @bdd @ratelimit @claim
  Scenario: polling the handoff has its own minimum interval
    Given the CLI polled `/claim/exchange` less than the advertised interval ago
    When it polls again
    Then the response is 429 with code `rate_limited`
    And the response repeats the interval the CLI should honour

  # ─────────────────────────────────────────────────────────────────────
  # Operability
  # ─────────────────────────────────────────────────────────────────────

  @bdd @ratelimit @ops
  Scenario: limits are configuration, not constants in a handler
    Then every bucket's window and ceiling is resolved from configuration
    And a deployment can tighten them without a code change

  @bdd @ratelimit @ops
  Scenario: the limiter fails closed when its backing store is unavailable
    Given Redis is unreachable
    When a caller POSTs to `/provision`
    Then the request is refused
    And the refusal is logged as a platform fault
    # an open-on-failure limiter is exactly the state an abuser waits for;
    # provisioning is not important enough to serve unmetered.

  @bdd @ratelimit @ops
  Scenario: the claim path stays open when the limiter's store is unavailable
    Given Redis is unreachable
    When a legitimate owner POSTs to `/claim/handoff` with a valid token
    Then the claim is served
    # claiming needs a token that already proves possession, and locking
    # owners out of their own data on day 29 is worse than the abuse it stops.
