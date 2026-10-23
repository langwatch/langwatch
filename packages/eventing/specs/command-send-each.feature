Feature: A command sends a batch of payloads, each answered alone
  As the span admission path handing a request's spans to one command
  I want a batch send to check and answer every payload on its own
  So that one bad payload costs only itself and the rest still reach the queue in one call

  A command's sendEach checks each payload against the command's schema, routes the valid ones
  as send routes them, and answers every payload at its position. Staging the batch is the group
  queue's (packages/group-queue/specs/send-each.feature).

  @unit
  Scenario: A payload that fails the command's schema is rejected alone
    Given a batch in which one payload fails the command's schema
    When the command sends the batch
    Then that payload is answered as rejected
    And the others reach the shared queue, routed as a single send routes them

  @unit
  Scenario: Each payload carries the queue's own answer at its position
    Given the shared queue answers some payloads as deduplicated or unknown
    When the command sends the batch
    Then each payload is answered with the queue's answer for it, in the order sent

  @unit
  Scenario: A queue without batch sends takes the payloads one by one
    Given a shared queue that cannot send a batch
    When the command sends the batch
    Then each payload is sent in turn
    And a send that throws answers only its own payload as unknown
