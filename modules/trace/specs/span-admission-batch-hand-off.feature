Feature: Admitted spans are handed to the trace pipeline together
  As the trace receiver admitting a request's spans
  I want the claimed spans handed to the pipeline in one batched call
  So that the queue stages them in few script runs while each span keeps its own answer.

  # Why this exists: dev/docs/plans/redis-queue-perf.md, slice P1b.
  #
  # The receiver already claims a request's spans in one dedup round trip, but then sent each
  # span to the queue on its own. Now it prepares each span individually and hands the claimed
  # ones off together; the queue answers each span. A span whose answer is a failure, or whose
  # answer is unknown, releases its claim so the exporter's resend reaches the pipeline again
  # under the same identity, where the queue's 30-second dedup collapses it.

  @unit
  Scenario: The claimed spans of a request are handed off in one call
    Given a request whose spans are all claimed
    When the receiver collects them
    Then they reach the pipeline in one call, in request order

  @unit
  Scenario: Only spans the pipeline took are confirmed, after it answered
    Given a request with a span held elsewhere, one claimed, and one whose claim went unanswered
    When the pipeline takes the claimed span and fails the other
    Then only the taken span is confirmed, once the pipeline has answered
    And the held span is answered as deduplicated without reaching the pipeline

  @unit
  Scenario: A span that fails its preparation fails alone and releases its claim
    Given a request where one span cannot be prepared
    When the receiver collects it
    Then that span fails and its claim is released, and the other spans still reach the pipeline

  @unit
  Scenario: A span the pipeline could not take releases its claim
    Given a request handed off whole where the pipeline fails some spans
    When the receiver reads the answers
    Then each failed span's claim is released and only the taken spans are confirmed

  @unit
  Scenario: A hand-off that fails outright fails every span it carried
    Given a request whose hand-off call throws
    When the receiver collects it
    Then every claimed span fails and releases its claim, and nothing is confirmed

  @integration
  Scenario: A span whose staging answer was lost is sent again under the same identity
    Given a multi-span export where the queue staged one span but its answer was lost
    When the exporter resends the batch
    Then the first answer is retryable and the resend reaches the pipeline with the same span identity
