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
    When an admin registers an A2A agent for project "p1" through gatewayA2aTargets.create
    Then the target is stored for project "p1" with its header names, never their values
    And the project's gateways are told to reload their configuration
    And the gateway loads it with the project's configuration

  @unit
  Scenario: a project admin manages the project's own targets
    Given a user who may manage A2A targets of project "p1" only
    When they list, edit, block or delete A2A targets of project "p1"
    Then the permission is checked on project "p1"
    And a target of another project or an org-wide target is not found

  @unit
  Scenario: A2A targets have their own permission, apart from virtual keys
    Given a user whose role manages every virtual key but holds no gatewayA2aTargets permission
    When they list, register, edit, block or archive an A2A target
    Then they are refused, at the project and at the organization
    And a user holding gatewayA2aTargets:manage may do all of it
    And a user holding gatewayA2aTargets:view may list targets and change none

  @unit
  Scenario: The built-in roles hold the A2A target permissions they hold on cache rules
    Then team viewers and members may list a project's targets and change none
    And team admins may manage a project's targets
    And organization admins may manage every target of the organization

  @unit
  Scenario: a key reaches a project's targets through its own scopes, never its trace destination
    Given a target registered for project "p1"
    And a virtual key whose traces go to project "p1" but whose scopes reach only project "p2"
    Then the key's configuration carries none of project "p1"'s targets
    And a key whose project, team or organization scope reaches "p1" carries them

  @unit
  Scenario: a target the gateway cannot call safely is left out of the configuration
    Given the configuration holds a target whose URL is not http or https, or whose header holds a line break
    Then the gateway leaves that target out

  @unit
  Scenario: a target URL that holds credentials is refused at save time
    When an admin saves a target whose upstream or Agent Card URL carries a user name or password
    Then the target is refused with a message that points at the sealed upstream headers
    And the message does not repeat the credentials
    And the gateway leaves such a target out of the configuration

  @unit
  Scenario: the target's saved upstream headers never follow its upstream to a new origin
    Given the target "billing" has saved upstream headers
    When an admin moves its upstream URL to another scheme, host or port without sending headers
    Then the edit is refused
    And a path change on the same origin keeps the saved headers
    And a move that sends a new header set is saved

  @unit
  Scenario: listed targets show their header names, never their values
    Given a target saved with the upstream headers "X-Agent-Tenant" and "X-Agent-Region"
    When an admin lists the organization's targets or the project's targets
    Then the listed target names the headers "X-Agent-Region" and "X-Agent-Tenant"
    And no listed target carries a header value

  @unit
  Scenario: every A2A target write is audited without header values
    When an admin creates, edits, blocks, unblocks or archives a target
    Then a gateway audit row records the action, the actor and the target before and after
    And the rows carry header names but never header values

  @unit
  Scenario: the Agent Card is served with the gateway URL in place of the upstream
    When the caller fetches GET /a2a/billing/.well-known/agent-card.json
    Then the gateway fetches the card from the target's card URL
    And every interface URL in the card points at the gateway's /a2a/billing
    And no URL in the card points at "https://billing.acme.test"
    And the card carries none of the upstream's signatures, which signed the URLs the gateway replaced
    And numbers in the card keep the digits the upstream wrote

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
  Scenario: a task id with an escaped colon is a task id, not an action
    When the caller sends GET /a2a/billing/tasks/team%3A42
    Then the gateway forwards it as GetTask for task "team:42"
    And POST /a2a/billing/tasks/team%3A42:cancel is forwarded as CancelTask

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
  Scenario: a key's stream_chunk guardrails judge every streamed event
    Given the caller's key has a stream_chunk guardrail that denies "card number"
    When the second streamed event carries a text part saying "card number"
    Then the caller receives the first event
    And then one error event with reason "a2a_content_blocked"
    And a stream_chunk check that cannot complete lets the event through, as on the LLM routes

  @unit
  Scenario: the trace continues through the hop
    When the caller sends a call with traceparent "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    Then the upstream receives a traceparent with trace id "4bf92f3577b34da6a3ce929d0e0e4736"
    And the gateway records a span "invoke_agent billing" in that trace
    And the span carries "gen_ai.agent.name", "a2a.method", "a2a.protocol.binding" and "langwatch.a2a.caller.virtual_key_id"
    And a JSON-RPC reply without a result never records the request id as "a2a.task.id"

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
  Scenario: a payload is served with bounded allocations with and without a guardrail
    When the caller sends a 1 MiB body made of many small parts
    Then serving it allocates a small multiple of the body size, with or without a guardrail
    And the payload's text is collected only when a guardrail applies

  @unit
  Scenario: a virtual key with too many calls in flight is refused
    Given the caller's virtual key already has 8 A2A calls in flight
    When it sends another call over HTTP+JSON
    Then the caller receives HTTP 429 with reason "a2a_too_many_requests"
    When it sends another call over JSON-RPC
    Then the caller receives a JSON-RPC error with code -32020 and reason "a2a_too_many_requests"
    And the error carries the request id
    And the upstream is not called

  @unit
  Scenario: a body that stops arriving is refused, not waited on
    When the caller sends part of a request body and then stops sending
    Then the caller receives HTTP 400 with reason "a2a_invalid_request" once the request body timeout passes
    And the upstream is not called
    When the upstream sends the headers and part of a reply that is not a stream and then stops sending
    Then the caller receives reason "a2a_upstream_unreachable" once the reply body timeout passes

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
  Scenario: a JSON-RPC method that is not an A2A method is refused
    When the caller sends POST /a2a/billing with JSON-RPC method "admin/drop_all"
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32601 and reason "a2a_operation_not_supported"

  @unit
  Scenario: a JSON-RPC envelope that names a member twice or in another case is refused
    When the caller sends POST /a2a/billing with "method" twice, with both "method" and "Method", or with "id", "jsonrpc" or "params" repeated or in another case
    Then the upstream is not called
    And the caller receives a JSON-RPC error with code -32600 and reason "a2a_invalid_request"

  @unit
  Scenario: the query string of the upstream URL stays after the forwarded path
    Given the target's upstream URL is "https://billing.acme.test/?tenant=7"
    When the caller sends POST /a2a/billing/message:send?x=1
    Then the upstream receives POST /message:send?tenant=7&x=1

  @unit
  Scenario: a caller's query parameter never overrides one the upstream URL sets
    Given the target's upstream URL is "https://billing.acme.test/?tenant=7"
    When the caller sends POST /a2a/billing/message:send?tenant=8&ten%61nt=9&x=1
    Then the upstream receives POST /message:send?tenant=7&x=1

  @unit
  Scenario: the Agent Card lists only the endpoint the gateway serves
    Given the upstream card lists interfaces at the upstream URL and at another path
    When the caller fetches GET /a2a/billing/.well-known/agent.json, the A2A v0.2 card path
    Then the card's url and its one interface point at the gateway's /a2a/billing
    And the interface at the other path is left out
    And an interface naming the upstream URL in another host case or with its default port is kept

  @unit
  Scenario: an A2A v0.2 card request reads the agent's v0.2 card path
    Given the target "billing" has no Agent Card URL
    When the caller fetches GET /a2a/billing/.well-known/agent.json
    Then the gateway fetches the card from /.well-known/agent.json under the target's upstream
    And a target with an Agent Card URL is fetched from that URL on either path

  @unit
  Scenario: content outside text parts is scanned before the upstream
    Given the caller's key has a request guardrail that denies a token
    When the token sits in a data part, in the bytes of a text file part (padded or unpadded, standard or URL-safe base64), or in message metadata
    Then the upstream is not called
    And the caller receives reason "a2a_content_blocked"

  @unit
  Scenario: text under a protocol field name inside a data part or metadata is scanned
    Given the caller's key has a request guardrail that denies a token
    When the token sits under a key named id, role, kind, state or timestamp inside a data part or a metadata object
    Then the upstream is not called
    And the caller receives reason "a2a_content_blocked"

  @unit
  Scenario: the extended Agent Card reply points at the gateway in v1.0 and v0.3
    When the caller calls GetExtendedAgentCard or the v0.3 agent/getAuthenticatedExtendedCard
    Then the card in the reply points at the gateway's /a2a/billing
    And the reply does not name the upstream URL

  @unit
  Scenario: an extended Agent Card error reply is relayed without a gateway card URL
    When the upstream answers the extended Agent Card call with a JSON-RPC or HTTP+JSON error, or with HTTP 503 and a body such as {"message":"unavailable"} that has no error wrapper
    Then the caller receives the error reply unchanged
    And the reply carries no gateway card URL
    And the error reply is still scanned by the key's response guardrails
    And a reply of JSON null is relayed unchanged

  @unit
  Scenario: the Agent Card is scanned before it reaches the caller
    Given the caller's key has a response guardrail that denies a token
    When the upstream Agent Card carries the token in its description
    Then the caller receives reason "a2a_content_blocked"
    And the card text does not reach the caller

  @unit
  Scenario: a stream line that is not an SSE data, event, id or retry field never reaches the caller
    When the upstream streams a comment line or a line with no field name
    Then the caller receives the event without that line
    And a denied token in an event or id field ends the stream with reason "a2a_content_blocked"

  @unit
  Scenario: a path that could leave the upstream base path is refused
    When the caller sends a GET or a POST on a path with a dot segment, or an encoded slash, backslash, "?" or "#"
    Then the upstream is not called
    And the caller receives HTTP 400 with reason "a2a_invalid_request" in the HTTP+JSON error shape

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
  Scenario: caller headers named in Connection are not forwarded
    When the caller sends "A2A-Extensions" and names it in its Connection header
    Then the upstream does not receive the caller's "A2A-Extensions"
    And an "A2A-Extensions" header configured on the target is still sent

  @unit
  Scenario: an A2A reply is never marked cacheable by a shared cache
    When the upstream replies with "Cache-Control: public"
    Then the caller receives "Cache-Control: no-store" on replies, streams, Agent Cards and refusals

  @unit
  Scenario: a call without a valid virtual key is refused uncacheable too
    When the caller sends POST /a2a/billing with no virtual key
    Then the caller receives 401 with "Cache-Control: no-store"

  @unit
  Scenario: an overlong streamed event ends the stream with an error event
    When the upstream streams an event over 1 MiB
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
  Scenario: a refusal caused by an error keeps the cause for the operator
    When a call is refused with "a2a_scan_unavailable" or "a2a_upstream_unreachable"
    Then the error behind it is recorded on the hop span and in a gateway log line
    And the caller's reply does not carry it
    And the recorded error never holds the query or user info of the upstream URL

  @unit
  Scenario: the config version token reads the same A2A targets as the bundle
    Given a virtual key whose trace project no longer resolves
    When the gateway asks for the key's config version token
    Then the token fingerprints the A2A targets of the same scope the bundle carries

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
  Scenario: an Agent Card URL on plain http is refused where https is required
    Given the gateway requires https for customer endpoints
    And the target "billing" has an https upstream and an http Agent Card URL
    When the caller fetches GET /a2a/billing/.well-known/agent-card.json
    Then the Agent Card URL is not fetched
    And the caller receives HTTP 502 with reason "a2a_target_not_https"

  @unit
  Scenario: the target's upstream headers go only to an Agent Card on the upstream's own origin
    When the target's Agent Card URL differs from its upstream in scheme, host or port
    Then the gateway fetches the card without the target's upstream headers
    When the Agent Card URL is on the upstream's own scheme, host and port
    Then the card fetch carries the target's upstream headers

  @unit
  Scenario: Agent Card URLs use the configured public base URL
    Given the gateway's public base URL is "https://gateway.acme.test"
    When the caller fetches the Agent Card with another Host and X-Forwarded-Proto
    Then every interface URL in the card starts with "https://gateway.acme.test/a2a/billing"

  @unit
  Scenario: an Agent Card is refused when the gateway has no public base URL
    Given the gateway has no public base URL configured
    When the caller fetches the Agent Card or calls GetExtendedAgentCard, with any Host header
    Then the upstream is not called
    And the caller receives reason "a2a_public_url_unset", with HTTP 503 or JSON-RPC code -32024
    And other A2A calls are still forwarded

  @unit
  Scenario: a phrase split across streamed events is scanned whole
    Given the key scans replies for "card number"
    When the upstream streams "your card num" and then "ber 4111" as appended artifact text
    Then the first event is forwarded
    And the stream ends with an error event with reason "a2a_content_blocked"
    And "4111" never reaches the caller
    And "your card" and " number 4111" as two text parts of the first event are scanned joined

  @unit
  Scenario: a phrase split across streamed events is scanned whole with names and ids between them
    Given the key scans replies for "card number"
    When the upstream streams "your card num" and then "ber 4111" as text of artifact "a1" named "answer", or as status message text
    And each event carries SSE event and id lines
    Then the stream ends with an error event with reason "a2a_content_blocked"
    And "4111" never reaches the caller

  @unit
  Scenario: text of artifacts streamed side by side is scanned per artifact
    Given the key scans replies for "card number"
    When the upstream streams "your card num" for artifact "a1", then text for artifact "a2", then "ber 4111" for artifact "a1"
    Then the stream ends with an error event with reason "a2a_content_blocked"
    And "your card" in artifact "a1" followed by " number of items" in artifact "a2" is forwarded, not joined into one phrase
    And "your card" in artifact "a1", replaced by a file-only "a1", then " number of items" appended to "a1" is forwarded

  @unit
  Scenario: an allowed host may resolve to a local address and no environment proxy is used
    Given local addresses are blocked
    Then a target on a local address is not called
    And a host listed in ALLOWED_PROXY_HOSTS may resolve to a local address
    And an IP address listed in ALLOWED_PROXY_HOSTS admits a URL naming that IP, never a hostname that resolves to it
    And the upstream client uses no environment proxy
