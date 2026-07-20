Feature: Non-streaming responses stay warm during slow dispatch
  As an operator running the AI Gateway behind an edge proxy (e.g. Cloudflare)
  I want a slow non-streaming completion to keep the client connection alive
  So that large-context requests aren't blindsided by the edge's
  idle-connection timeout (HTTP 524)

  Background:
    Cloudflare (and similar edge proxies) return HTTP 524 when a connection
    to the origin is established but receives no response bytes within its
    idle-connection window (~100s), even though the origin is healthy and
    still working. The gateway's own timeouts are tuned for minutes-long
    completions (14 minute upstream ceiling, no WriteTimeout on the Go
    server — see provider-request-timeout.feature), but that budget alone
    says nothing about what the *client* sees while dispatch is running: a
    non-streaming request that takes longer than HeartbeatInterval now gets
    a keep-alive byte (RFC 8259 §2 insignificant whitespace) written and
    flushed periodically until dispatch completes.

    # Issue: https://github.com/langwatch/langwatch/issues/4806
    # Bindings: services/aigateway/adapters/httpapi/nonstreaming_ttfb_test.go
    # Sender: services/aigateway/adapters/httpapi/router.go (withHeartbeat, writeJSONResponse)

  @unit @regression
  Scenario: non-streaming client receives zero response bytes for dispatch faster than the heartbeat interval
    Given a provider that has not yet returned a completion
    When a client sends a non-streaming chat completion request
    And dispatch finishes before HeartbeatInterval elapses
    Then no response bytes, including headers, have reached the client before dispatch finished
    And the full response is delivered exactly as it always was
    And the response does not carry an X-LangWatch-Heartbeat-Active header
    # Fast requests — the overwhelming majority — are byte-for-byte
    # unaffected by the heartbeat mechanism below.

  @unit @regression
  Scenario: dispatch slower than the heartbeat interval keeps the connection warm and still delivers the correct response
    Given a provider that takes longer than HeartbeatInterval to complete
    When a client sends a non-streaming chat completion request
    Then a keep-alive byte reaches the client while dispatch is still in flight
    And the client's JSON parser still parses the eventual response correctly
    And once dispatch finishes, the full response is delivered with status 200 and Content-Type application/json
    And the response carries an X-LangWatch-Heartbeat-Active header
    # This is the fix for #4806: a large-context completion that legitimately
    # runs long now keeps producing bytes, so it never goes silent long
    # enough for an edge proxy to kill the connection.

  @unit @regression
  Scenario: dispatch that errors after heartbeating has started still delivers a structured error body
    Given a provider that takes longer than HeartbeatInterval and then fails
    When a client sends a non-streaming chat completion request
    Then a keep-alive byte reaches the client while dispatch is still in flight
    And once dispatch fails, the response status is still 200
    And the response body is the same structured error envelope a fast failure would have produced
    And the response carries an X-LangWatch-Heartbeat-Active header
    # Once any byte is on the wire the HTTP status is irrevocably committed
    # to 200 — the same trade-off the streaming path already accepts for
    # errors that surface mid-stream (see streaming.feature). The header is
    # the mitigation: its presence on a 200 is the signal for a client that
    # only checks status to check the body for an error key instead of
    # trusting the status at face value — a strict improvement over today's
    # 524 with no body at all.

  @unit @regression
  Scenario: a negative heartbeat interval disables the mechanism entirely
    Given HeartbeatInterval is configured to a negative duration
    And a provider that takes longer than a would-be heartbeat tick to complete
    When a client sends a non-streaming chat completion request
    Then no keep-alive byte ever reaches the client before dispatch finishes
    And the response never carries an X-LangWatch-Heartbeat-Active header
    # Operator kill switch (NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS=-1) to
    # roll the fix back without a redeploy.
