Feature: AI Gateway Governance — Receiver auth rate limiting
  As an operator running the governance ingest receivers
  I want a per-IP rate-limit at the top of `/api/ingest/*`
  So that a brute-force token scan can't pin Postgres on the bearer-token
  lookup or amplify into an outage if a misconfigured client retries
  in a hot loop

  Today (pre-this-slice), `authIngestionSource` does:
    1. cheap regex on `Authorization: Bearer lw_is_<...>`
    2. `IngestionSourceService.findByIngestSecret` → Postgres findFirst
       on hashed-secret column

  Step 2 is unbounded. A scanner that hammers /api/ingest/otel/<id> with
  random bearer tokens hits the DB on every attempt — the regex doesn't
  cost anything but the DB roundtrip does. This spec pins a per-IP
  fixed-window limit wedged between regex and DB so brute-force or
  misconfigured-retry traffic shed at L7 instead of saturating PG.

  Background:
    Given the governance ingest receiver is mounted at /api/ingest
    And the per-IP rate limit is 60 requests / 60s by default
    And the rate-limit window key is `lwingest:rate:<ip>` in Redis
    And the test environment sets `LW_INGEST_RATE_LIMIT_DISABLED=1` so
      bulk volume tests don't trip the limit

  # ============================================================================
  # Under-limit traffic passes through
  # ============================================================================

  @bdd @phase-5 @rate-limit @under
  Scenario: First request from a fresh IP is allowed
    When client at IP "203.0.113.5" POSTs to /api/ingest/otel/<sourceId>
    Then the rate-limit middleware allows the request
    And the underlying handler runs (auth + handoff to trace pipeline)
    And the response is 202 (assuming valid bearer + body)

  # ============================================================================
  # Over-limit traffic shed at L7
  # ============================================================================

  @bdd @phase-5 @rate-limit @over
  Scenario: 61st request within the window returns 429 with Retry-After
    Given client at IP "203.0.113.5" has made 60 requests in the current 60s window
    When the 61st request arrives
    Then the response is 429 with body `{ error: "rate_limited", error_description: "..." }`
    And the response includes header `Retry-After: <seconds-until-window-resets>`
    And the underlying handler does NOT run (no DB lookup, no trace handoff)
    And the rejection is logged with the IP + window count

  @bdd @phase-5 @rate-limit @over
  Scenario: Over-limit applies regardless of auth outcome
    Given the 60 requests included both valid + invalid bearers
    When the 61st request arrives (regardless of bearer validity)
    Then the response is 429
    # Brute-force scanners deliberately try invalid tokens; we must
    # protect the DB even when every attempt would have failed auth.

  # ============================================================================
  # Window reset
  # ============================================================================

  @bdd @phase-5 @rate-limit @window
  Scenario: Window resets after TTL elapses
    Given client at IP "203.0.113.5" has hit the limit
    And the 60s window has elapsed (the Redis key TTL'd out)
    When the next request arrives
    Then the response is 202 (assuming valid bearer + body)
    And the in-memory counter restarts from 1

  # ============================================================================
  # Per-IP isolation
  # ============================================================================

  @bdd @phase-5 @rate-limit @isolation
  Scenario: Two IPs share no quota
    Given client at IP "203.0.113.5" has hit the limit
    When client at IP "198.51.100.7" makes a request
    Then "198.51.100.7" passes through (separate window key)

  # ============================================================================
  # Best-effort under Redis failure
  # ============================================================================

  @bdd @phase-5 @rate-limit @degraded
  Scenario: Redis unavailable → rate limit soft-fails open
    Given the Redis connection is unavailable (e.g. cluster degraded)
    When a request arrives
    Then the rate-limit middleware logs a warning
    And the request is ALLOWED through to the underlying handler
    # Open-fail: ingest path stays available even if the rate-limiter
    # is down. The brute-force protection is best-effort layered
    # defence; the regex+DB path still does its own auth check.

  # ============================================================================
  # Test/dev escape hatch
  # ============================================================================

  @bdd @phase-5 @rate-limit @opt-out
  Scenario: LW_INGEST_RATE_LIMIT_DISABLED bypass for tests + dev
    Given LW_INGEST_RATE_LIMIT_DISABLED=1
    When 1000 requests arrive in quick succession from a single IP
    Then none are 429'd by the rate-limit middleware
    # The volume regression test depends on this — without the
    # bypass, the 1k spans/sec scenario would shed at the rate
    # limit before measuring receiver throughput.
