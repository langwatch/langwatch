Feature: A2A proxy on the gateway
  As a platform team running agents that call other agents over A2A
  I want every agent-to-agent hop to go through the gateway
  So that I decide which agent may call which, scan what they send each
  other, stop a hop on demand and see every hop in the same trace.

  The gateway proxies A2A v1.0 (https://a2a-protocol.org/latest/specification/)
  under /a2a/{target}. A target is an A2A agent registered for the caller's
  project: its upstream base URL, its Agent Card URL, the headers the gateway
  sends upstream, an optional allow list and a block switch. The caller is an
  agent that authenticates with its own virtual key.

  Background:
    Given a target "billing" registered for project "p1" with upstream "https://billing.acme.test/a2a"
    And the caller presents virtual key "vk_support" of project "p1"

  @unimplemented
  Scenario: targets are registered from the control plane
    When an admin registers an A2A agent in the project settings
    Then the gateway loads it with the project's configuration

  @unit
  Scenario: the Agent Card is served with the gateway URL in place of the upstream
    When the caller fetches GET /a2a/billing/.well-known/agent-card.json
    Then the gateway fetches the card from the target's card URL
    And every interface URL in the card points at the gateway's /a2a/billing
    And no URL in the card points at "https://billing.acme.test"

  @unit
  Scenario: an allowed JSON-RPC call is forwarded
    Given the target "billing" allows virtual key "vk_support"
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream receives the same body at its base URL
    And the caller's virtual key is not forwarded upstream
    And the target's configured upstream headers are sent
    And the caller receives the upstream response

  @unit
  Scenario: an HTTP+JSON call is forwarded on its path
    When the caller sends POST /a2a/billing/message:send
    Then the upstream receives POST /a2a/message:send under its base URL

  @unit
  Scenario: a target with no allow list accepts any key of its project
    Given the target "billing" has no policy
    When the caller sends a JSON-RPC "GetTask" to POST /a2a/billing
    Then the call is forwarded

  @unit
  Scenario: a caller missing from the allow list is refused
    Given the target "billing" allows only virtual key "vk_finance"
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32010 and reason "a2a_caller_not_allowed"
    And the error carries the request id

  @unit
  Scenario: a blocked target refuses every caller
    Given the target "billing" is blocked
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32011 and reason "a2a_target_blocked"

  @unit
  Scenario: an unknown target is refused
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/unknown
    Then the caller receives a JSON-RPC error with code -32013 and reason "a2a_target_not_found"

  @unit
  Scenario: an HTTP+JSON refusal uses an HTTP status
    Given the target "billing" is blocked
    When the caller sends POST /a2a/billing/message:send
    Then the caller receives HTTP 403 with reason "a2a_target_blocked"

  @unit
  Scenario: the outgoing message is scanned and a deny verdict blocks it
    Given the caller's key has a request guardrail that denies "wire the money"
    When the caller sends a "SendMessage" whose text part says "wire the money"
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32012 and reason "a2a_content_blocked"

  @unit
  Scenario: the reply is scanned and a deny verdict blocks it
    Given the caller's key has a response guardrail that denies "card number"
    When the upstream replies with a task artifact whose text part says "card number"
    Then the caller receives a JSON-RPC error with code -32012 and reason "a2a_content_blocked"

  @unit
  Scenario: a streamed reply is forwarded event by event
    When the caller sends a JSON-RPC "SendStreamingMessage" to POST /a2a/billing
    And the upstream answers with a text/event-stream of three events
    Then the caller receives the three events in order as text/event-stream

  @unit
  Scenario: a streamed event that fails the scan ends the stream
    Given the caller's key has a response guardrail that denies "card number"
    When the second streamed event carries a text part saying "card number"
    Then the caller receives the first event
    And then one error event with reason "a2a_content_blocked"
    And the stream ends without the second event

  @unit
  Scenario: the trace continues through the hop
    When the caller sends a call with traceparent "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    Then the upstream receives a traceparent with trace id "4bf92f3577b34da6a3ce929d0e0e4736"
    And the gateway records a span "invoke_agent billing" in that trace
    And the span carries "gen_ai.agent.name", "a2a.method", "a2a.protocol.binding" and "langwatch.a2a.caller.virtual_key_id"
