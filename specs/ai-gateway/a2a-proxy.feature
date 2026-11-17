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

  @unit
  Scenario: targets are registered from the control plane
    When an admin registers an A2A agent in the project settings
    Then the gateway loads it with the project's configuration

  @unit
  Scenario: a project admin manages the project's own targets
    Given a user who may manage virtual keys of project "p1" only
    When they list, edit, block or delete A2A targets of project "p1"
    Then the permission is checked on project "p1"
    And a target of another project or an org-wide target is not found

  @unit
  Scenario: a target the gateway cannot call safely is left out of the configuration
    Given the configuration holds a target whose URL is not http or https, or whose header holds a line break
    Then the gateway leaves that target out

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
    And the caller receives a JSON-RPC error with code -32013 and reason "a2a_target_not_found"
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

  @unit
  Scenario: the hop's span is routed to the caller's project
    When the caller sends a call with traceparent "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    Then the span "invoke_agent billing" carries the caller's trace project as "langwatch.project_id"
    And its parent is the caller's traceparent, never a gateway-internal span

  @unit
  Scenario: a request body over the size limit is refused, not cut
    When the caller sends POST /a2a/billing/message:send with a body over 1 MiB
    Then the upstream is not called
    And the caller receives HTTP 413 with reason "a2a_payload_too_large"

  @unit
  Scenario: the outgoing scan covers every part of the payload, not only text parts
    Given the caller's virtual key has a request guardrail that blocks "wire the money"
    When the caller sends the phrase in a data part, a text file part, message metadata, params metadata or under "Parts" and "Text" keys
    Then the upstream is not called
    And the caller receives a JSON-RPC error with reason "a2a_content_blocked"

  @unit
  Scenario: the reply scan covers error messages and data parts
    Given the caller's virtual key has a response guardrail that blocks "card number"
    When the upstream replies with the phrase in error.message, error.data or a data part
    Then the caller receives a JSON-RPC error with reason "a2a_content_blocked"

  @unit
  Scenario: a payload is read without building a tree, and only when a guardrail applies
    When the caller sends a 1 MiB body made of many small parts
    Then serving it allocates a small multiple of the body size, with or without a guardrail

  @unit
  Scenario: a virtual key with too many calls in flight is refused
    Given the caller's virtual key already has 8 A2A calls in flight
    When it sends another call
    Then the caller receives HTTP 429 with reason "a2a_too_many_requests"
    And the upstream is not called

  @unit
  Scenario: a reply over the size limit is refused, not cut
    When the upstream replies with a body over 1 MiB
    Then the caller receives HTTP 502 with reason "a2a_payload_too_large"

  @unit
  Scenario: a method and path that is not an A2A operation is refused
    When the caller sends GET /a2a/billing/admin
    Then the upstream is not called
    And the caller receives HTTP 404 with reason "a2a_operation_not_supported"

  @unit
  Scenario: a path that could leave the upstream base path is refused
    When the caller sends a path with a dot segment, or an encoded slash, backslash, "?" or "#"
    Then the upstream is not called
    And the caller receives HTTP 400 with reason "a2a_invalid_request"

  @unit
  Scenario: a request the scanner cannot read is refused when the key scans requests
    Given the caller's key has a request guardrail
    When the caller sends POST /a2a/billing/message:send with a body that is not JSON
    Then the upstream is not called
    And the caller receives HTTP 422 with reason "a2a_content_unscannable"

  @unit
  Scenario: a reply the scanner cannot read is refused when the key scans replies
    Given the caller's key has a response guardrail
    When the upstream replies with text that is not JSON
    Then the caller receives HTTP 502 with reason "a2a_content_unscannable"
    And the reply text does not reach the caller

  @unit
  Scenario: hop-by-hop and cookie headers from the upstream are dropped
    When the upstream replies with hop-by-hop headers, headers named in Connection and Set-Cookie
    Then the caller receives none of them

  @unit
  Scenario: an overlong streamed event ends the stream with an error event
    When the upstream streams an event over 4 MiB
    Then the caller receives the events before it
    And then one error event with reason "a2a_payload_too_large"

  @unit
  Scenario: a redirect from the upstream is not followed
    When the upstream answers with a redirect to another host
    Then the other host is not called and does not receive the target's upstream headers
    And the caller receives HTTP 502 with reason "a2a_upstream_unreachable"

  @unit
  Scenario: an upstream on a blocked address is not called
    Given the gateway blocks local egress
    When the target's upstream resolves to a loopback, private, link-local or metadata address
    Then the upstream is not called
    And the caller receives HTTP 502 with reason "a2a_upstream_unreachable"

  @unit
  Scenario: a change to an A2A target reaches the gateway on the change feed
    When an A2A target of the organization is created, updated, blocked or deleted
    Then the gateway drops the organization's cached key bundles
    And the next call reads the target as it is now

  @unit
  Scenario: a virtual key over its rate limit is refused
    Given virtual key "vk_support" is over its requests-per-minute limit
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32021 and reason "a2a_rate_limited"

  @unit
  Scenario: a virtual key with a used up budget is refused
    Given a budget on virtual key "vk_support" is used up
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32022 and reason "a2a_budget_exceeded"
    And a budget check that fails admits the call, as on the LLM routes

  @unit
  Scenario: a plain http target is refused where https is required
    Given the gateway requires https for customer endpoints
    And the target "billing" has an http upstream
    When the caller sends a JSON-RPC "SendMessage" to POST /a2a/billing
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32023 and reason "a2a_target_not_https"

  @unit
  Scenario: Agent Card URLs use the configured public base URL
    Given the gateway's public base URL is "https://gateway.acme.test"
    When the caller fetches the Agent Card with another Host and X-Forwarded-Proto
    Then every interface URL in the card starts with "https://gateway.acme.test/a2a/billing"

  @unit
  Scenario: a phrase split across streamed events is scanned whole
    Given the key scans replies for "card number"
    When the upstream streams "your card num" and then "ber 4111" as appended artifact text
    Then the first event is forwarded
    And the stream ends with an error event with reason "a2a_content_blocked"
    And "4111" never reaches the caller

  @unit
  Scenario: an allowed host may resolve to a local address and no environment proxy is used
    Given local addresses are blocked
    Then a target on a local address is not called
    And a host listed in ALLOWED_PROXY_HOSTS may resolve to a local address
    And the upstream client uses no environment proxy
