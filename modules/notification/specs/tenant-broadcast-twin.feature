Feature: Publishing a tenant broadcast from a background process

  Three pipelines waiting to leave the application mapper end in the same
  Redis publish — a trace summary advancing, a simulation run advancing, a
  Langy conversation fold advancing. All three tell the same thing to the same
  listener: every browser tab holding an SSE subscription for that tenant.

  The listener is in the application and the publisher is not, so the channel
  name and the message body are a wire format between two processes that never
  type-check against each other. This is why one publisher is shared rather
  than one written per feature: three copies of a format nobody compiles
  together is three chances to get it wrong.

  Getting it wrong is silent in both directions. Redis accepts a publish onto a
  channel nobody subscribed to and answers zero; a body whose keys the
  subscriber cannot read is dropped inside its own parse handler. The durable
  write succeeded either way, the job reported success, and the customer's
  screen simply stopped moving.

  @unit
  Scenario: The channel is the event type, prefixed
    Given a tenant broadcast publisher
    When a process broadcasts a trace update to a tenant
    Then it publishes on the channel the application subscribes to
    And the channel name carries no other decoration

  @unit
  Scenario: The body is the three fields the subscriber reads
    Given a tenant broadcast publisher
    When a process broadcasts an event to a tenant
    Then the published body carries the tenant, the event and a timestamp
    And it carries no field the subscriber does not read

  @unit
  Scenario: Every channel the application listens on can be published to
    Given a tenant broadcast publisher
    When a process broadcasts once for every event type
    Then each publish lands on that type's own channel

  @unit
  Scenario: The producer's payload travels through untouched
    Given a tenant broadcast publisher
    When a process broadcasts an already-serialised payload
    Then the payload reaches the channel byte for byte

  @unit
  Scenario: A publish that fails does not fail the work that caused it
    Given a tenant broadcast publisher whose connection refuses
    When a process broadcasts an event to a tenant
    Then the broadcast does not raise
    And the failure is reported without repeating the tenant's payload
