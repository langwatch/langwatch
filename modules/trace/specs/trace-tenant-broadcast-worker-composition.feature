Feature: Telling a tenant's open tabs that a trace moved, from a worker

  Two of the trace ingestion subscribers tell the customer's open tabs that
  something changed: one when the trace summary fold advances, one when spans
  land in storage. Both reach a fan-out the process supplies, and both were
  named as an ad-hoc structural sink rather than a port — so a converting
  process had nothing to compose against.

  Trace now declares the capability it actually needs, and a background process
  answers it with the shared Redis publisher that already ships beside the mail
  capability. The channel and the message body are a WIRE FORMAT: the publisher
  is whichever process advanced the projection and the subscriber is the
  application serving the tab, and the two never type-check against each other.
  Drift is silent in both directions — an unknown channel is accepted by Redis
  and delivered to nobody — so both halves are pinned by literal.

  @unit
  Scenario: A trace summary advancing reaches the channel the application subscribes to
    Given a process holding the shared tenant broadcaster
    When the trace update broadcast subscriber runs
    Then the publish lands on the trace-updated channel

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
  Scenario: The envelope carries the tenant and the producer's payload verbatim
    Given a broadcast for a known tenant
    When the message is put on the wire
    Then it carries the tenant id and the producer's serialised payload unchanged

  @unit
  Scenario: A failed publish does not fail the ingestion that caused it
    Given a publisher that cannot reach Redis
    When the trace update broadcast subscriber runs
    Then the subscriber completes and the durable write stands

  @unit
  Scenario: A process with no Redis composes no broadcaster
    Given a deployment that configured no Redis
    When the trace broadcast composition is asked for a port
    Then it reports that this process cannot broadcast rather than accepting one
