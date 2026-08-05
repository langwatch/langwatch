Feature: Browser RUM and full-stack trace correlation

  Work a user starts in the browser and work the server does on their behalf
  belong to one trace. A click, the navigation it causes, the calls that
  navigation fires and the server work behind each call can all be read as a
  single object, and an error anywhere in it can be followed back to its origin.

  Browser telemetry describes the platform operating, not a customer's
  application. It is kept separate from customer OTLP ingest and is treated as
  untrusted input, because it arrives from a public browser.

  See ADR-058 for the architectural decisions behind this.

  Background:
    Given the browser telemetry feature is enabled
    And the application is instrumented for the browser

  Rule: One interaction produces one trace across the stack

    Scenario: A call started in the browser continues on the server
      When the user performs an action that calls the server
      Then the server work appears in the same trace as the browser work
      And the server span is a descendant of the browser span

    Scenario: Batched calls stay individually visible
      Given several calls are dispatched together as one network request
      When the user performs an action that triggers them
      Then each call appears as its own span within that request
      And a slow call is attributable without inspecting the others

    Scenario: Work started over a realtime connection is still visible
      Given the user performs an action delivered over a realtime connection
      When the server handles it
      Then the server work is still visible as its own trace

    Scenario: A long-lived connection does not capture later calls
      Given a connection was opened during some earlier trace
      When a later call arrives on that same connection
      Then the later call is not attributed to the trace that opened it

    Scenario: Navigating between pages is visible as work
      When the user navigates to another page
      Then the navigation appears as a span
      And the calls that navigation triggers appear beneath it
      And the span is named for the route rather than the page's address

    # The address carries project slugs and record ids. Named by address, a
    # span name would be unique per record and no aggregate would exist to ask
    # "how slow is this page".
    Scenario: A navigation is attributed to its route, not its address
      When the user opens a record on a page
      Then the navigation names the route it opened
      And the address it opened is recorded as an attribute

    Scenario: A navigation the user abandons is distinguishable
      Given a navigation is under way
      When the user navigates somewhere else before it arrives
      Then the abandoned navigation is marked as superseded
      And the work that follows belongs to the navigation they chose

    Scenario: Work well after a navigation is not attributed to it
      Given a navigation has arrived and the page has settled
      When a background call is made later
      Then it is not attributed to that navigation

    Scenario: Everything from one visit can be found together
      When the user performs several unrelated actions in one visit
      Then every resulting span carries the same session identifier

  Rule: Volume is controllable without losing whole answers

    # Head sampling propagates: an unsampled browser trace takes the server
    # spans down with it. The lever is real, so what it keeps has to stay
    # usable.
    Scenario: Reducing volume keeps whole visits rather than fragments
      Given telemetry is configured to record a share of visits
      When a recorded visitor performs several actions
      Then every action from that visit is recorded

    Scenario: A visit outside the share costs nothing
      Given telemetry is configured to record a share of visits
      When a visitor outside that share performs several actions
      Then none of their actions are recorded
      And the server work behind them is not recorded either

    Scenario: Recording everything is the default
      Given nothing has been said about how much to record
      When a visitor performs an action
      Then it is recorded

    # Collecting nothing is a silent failure — nobody notices missing
    # telemetry until they need it.
    Scenario: A nonsensical share records rather than silently collecting nothing
      Given the share to record is configured to something meaningless
      When a visitor performs an action
      Then it is recorded

  Rule: Telemetry never degrades the product

    Scenario: A failing telemetry pipeline leaves the application working
      Given the telemetry endpoint is unreachable
      When the user performs an action that calls the server
      Then the call succeeds
      And the user sees no error

    Scenario: Instrumentation failure does not fail the call
      Given the client instrumentation raises an error while handling a call
      When the user performs an action that calls the server
      Then the call is delivered unchanged

    Scenario: Telemetry is silent when disabled
      Given the browser telemetry feature is disabled
      When the user performs an action that calls the server
      Then no telemetry leaves the browser

  Rule: Browser telemetry is platform-internal, never customer data

    Scenario: Browser telemetry is identifiable as internal
      When the browser reports telemetry
      Then the telemetry is marked as originating from the platform itself

    Scenario: Browser telemetry does not enter customer ingest
      When the browser reports telemetry
      Then it is not recorded against any customer's project

  Rule: The ingest endpoint treats browser input as untrusted

    Scenario: A client sending too much is throttled
      Given a client reports telemetry far above the expected rate
      When it continues reporting
      Then further reports are rejected
      And previously accepted telemetry is unaffected

    # A caller's claimed identity is self-asserted and freely rotated, so
    # per-caller limits alone bound only accidents. The endpoint is bounded as a
    # whole as well.
    Scenario: A flood spread across many claimed identities is still bounded
      Given clients reporting telemetry under a new identity each time
      When their combined rate exceeds what the endpoint accepts
      Then further reports are rejected regardless of the identity claimed

    Scenario: An oversized report is rejected
      When a client reports telemetry larger than the accepted size
      Then the report is rejected before it reaches the collector

    Scenario: A report carrying too many spans is rejected
      When a client reports far more spans than a browser produces
      Then the report is rejected before it reaches the collector

    Scenario: Telemetry cannot claim to come from another service
      When a client reports telemetry claiming to originate from a different service
      Then the telemetry that reaches the collector is attributed to the browser app

    # An OTLP exporter retries a server error, so answering a collector outage
    # with one would turn every open tab into a retry loop against the app.
    Scenario: A collector outage does not provoke the browser into retrying
      Given the collector is unreachable
      When a client reports telemetry
      Then the client is told the report was accepted
      And the drop is recorded for operators

  Rule: A recorded error can be followed to its trace

    Scenario: An error captured in the browser carries its trace
      Given a call is in progress
      When an error is captured
      Then the captured error records the trace it happened in

    Scenario: An error captured on the server carries its trace
      Given the server is handling a call
      When an error is captured
      Then the captured error records the trace it happened in

    Scenario: An error captured outside any call records no trace
      Given no call is in progress
      When an error is captured
      Then the captured error is still recorded
      And it claims no trace
