Feature: Telling a tenant's open tabs that a trace moved, from another process

  Two of the trace ingestion subscribers tell the customer's open tabs that
  something changed: one when the trace summary fold advances, one when spans
  land in storage. They run in the worker; the tabs are subscribed to the api.
  A finished background discover refresh in the api tells the same tabs to
  refetch their facets, and a running export reports its progress the same way.

  Trace publishes through presence (`PresenceApi.publishProjectEvent`, record
  §3.3) on the `trace_updated` and `discover_updated` channels. Presence is the
  one writer of the `broadcast:*` wire: its fan-out subscribes in every process
  and relays each message to the tenant's emitter, which Trace's subscriptions
  read. Trace keeps no Redis broadcast of its own.

  @unit
  Scenario: A trace summary advancing reaches the channel the application subscribes to
    Given an api subscribed to a tenant's trace updates
    When the worker's trace update broadcast subscriber runs
    Then the api's open subscription receives the push

  @unit
  Scenario: The trace summary body is the one the browser already reads
    Given a trace whose summary fold advanced
    When the broadcast is published
    Then the payload names the summary update and the trace it belongs to

  @unit
  Scenario: A span landing publishes its own body, not the summary's
    Given spans that have just been written to storage
    When the span storage broadcast subscriber runs
    Then the payload names the span storage event and the trace it belongs to

  @unit
  Scenario: A failed publish does not fail the ingestion that caused it
    Given presence refusing the publish
    When the trace update broadcast subscriber runs
    Then the subscriber completes and the durable write stands

  @unit
  Scenario: A closed live-update subscription releases the tenant's emitter
    Given an api subscribed to a tenant's discover refreshes
    When the subscription's signal aborts
    Then the stream ends and the tenant's emitter is released

  @unit
  Scenario: A finished discover refresh tells the tenant's tabs to refetch
    Given a tenant whose discover snapshot is cold
    When the background refresh lands
    Then a discover_updated signal naming the tenant is published

  @unit
  Scenario: A discover refresh published by one process reaches another process's subscription
    Given an api subscribed to a tenant's discover refreshes
    When another process publishes the tenant's discover refresh
    Then the subscription receives the signal

  @unit
  Scenario: Export progress published by another process reaches the watching viewer
    Given a viewer watching an export another process runs
    When that process publishes progress and then done
    Then the viewer receives both frames and the stream ends
