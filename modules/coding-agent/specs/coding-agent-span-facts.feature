Feature: Coding-agent derives session facts from received spans

  A coding-agent session folds facts from the spans trace receives. Trace
  records one span-received fact per span and knows nothing of coding agents;
  coding-agent subscribes to that fact on its own pipeline, decodes the span
  with trace's contract decoder, and asks trace's API to canonicalise the
  span's attributes so its facts read the same canonical names trace stores.
  Trace keeps no dispatch towards coding-agent, so the peer edge points one
  way only (ARCHITECTURE.md section 5).

  @unit
  Scenario: A received coding-agent span becomes session facts through coding-agent's own peer subscriber
    Given coding-agent's session pipeline composed over its own substrate
    When trace records the span-received fact for a Claude Code model call
    Then coding-agent's peer subscriber on that fact decodes the span
    And it asks trace's API to canonicalise the span's attributes
    And it contributes the span's session facts, carrying the model the call named

  @unit
  Scenario: Trace's API canonicalises a span's attributes as ingest does
    Given a Claude Code model-call span naming its model and token counts
    When the span is decoded by trace's contract decoder and canonicalised through trace's API
    Then the attributes and events equal those trace's ingest stores for the same span
    And the model is carried under the canonical request-model name

  @unit
  Scenario: A span no coding agent claims mints no coding-agent job
    Given the peer subscriber coding-agent mounts on trace's span-received fact
    When a span arrives that no coding agent claims by name and scope
    Then the enqueue filter declines it and no job is minted

  @unit
  Scenario: A redelivered span resolves to the coding-agent job already queued
    Given the peer subscriber coding-agent mounts on trace's span-received fact
    When the same span-received fact is delivered twice
    Then both deliveries share one deduplication identity per tenant, trace and span

  @unit
  Scenario: A span that cannot be decoded or canonicalised completes without contributing facts
    Given the peer subscriber coding-agent mounts on trace's span-received fact
    When the span it is handed cannot be decoded or trace's API refuses to canonicalise it
    Then the job completes quietly and no session facts are contributed
