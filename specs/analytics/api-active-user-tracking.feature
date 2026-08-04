Feature: API active user tracking
  As a growth analyst
  I want every authenticated API caller to count toward Weekly Active Users
  regardless of whether they came from the web, MCP server, CLI, or a skill
  So that WAU/DAU/MAU reflect real product engagement across all surfaces
  Without burning PostHog event volume on every individual API call

  Background:
    Given the unified auth middleware is mounted on a Hono route
    And the request carries a valid PAT token resolving to a known userId
    And PostHog is configured (POSTHOG_KEY is set)

  @unit @unimplemented
  Scenario: First successful PAT request of the day fires api_active_user
    When the request succeeds with a 2xx response
    And no api_active_user heartbeat exists for this (userId, day, source) in Redis
    Then a single api_active_user PostHog event is captured
    And distinctId equals the resolved userId
    And properties.source matches the User-Agent (e.g. "mcp" / "cli" / "skill" / "unknown")
    And properties.version matches the User-Agent version segment when present
    And a Redis key active_user:<userId>:<UTC-day>:<source> is set with TTL ~48h

  @unit @unimplemented
  Scenario: Subsequent same-day same-source request does not refire
    Given the heartbeat for (userId, day, source) already exists in Redis
    When another successful PAT request from the same source arrives the same UTC day
    Then no api_active_user event is captured
    And the request completes normally

  @unit @unimplemented
  Scenario: Different sources for the same user count separately
    Given the user already has a heartbeat for source "mcp" today
    When the same user makes a successful request from source "cli" the same day
    Then a single api_active_user event is captured for source "cli"

  @unit @unimplemented
  Scenario: Failed authentication does not fire
    When the request is rejected with a 401 before reaching next()
    Then no api_active_user event is captured
    And no Redis heartbeat key is written

  @unit @unimplemented
  Scenario: Handler 5xx does not fire
    When the request authenticates but the downstream handler returns 500
    Then no api_active_user event is captured

  @unit @unimplemented
  Scenario: Legacy project tokens without userId are skipped
    Given the request authenticates via a legacy sk-lw- project token (no userId)
    When the request succeeds
    Then no api_active_user event is captured
    Because the metric is user-scoped and legacy tokens cannot resolve to a single user

  @unit @unimplemented
  Scenario: Redis outage does not break the request
    Given Redis throws on the SET NX call
    When the request succeeds
    Then the request response is unaffected
    And api_active_user fires anyway as a graceful overcount
    And the Redis error is logged at WARN

  @unit @unimplemented
  Scenario: Missing User-Agent maps to unknown source
    Given the request has no User-Agent header
    When the request succeeds
    Then properties.source equals "unknown"
    And properties.version is absent

  @unit @unimplemented
  Scenario: MCP server outbound requests are tagged
    Given the MCP server makes an outbound API call to the LangWatch backend
    Then the outbound request carries User-Agent: langwatch-mcp/<package version>
    So the backend can attribute the call to the "mcp" source
