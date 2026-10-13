Feature: Evaluation trigger subscriber gating

  Evaluation dispatch accepts genuine message events from resolved traces and
  rejects events that cannot produce a valid evaluation request.

  @unit
  Scenario: The origin guard declines a non-message event
    Given a topic-assigned event on a trace with a resolved origin
    Then the evaluation trigger declines the event

  @unit
  Scenario: The origin guard declines a trace with no resolved origin
    Given a span event on a trace whose origin is unresolved
    Then the evaluation trigger declines the event

  @unit
  Scenario: The origin guard admits a genuine message event
    Given a recent span event on a recent trace with a resolved origin
    Then the evaluation trigger accepts the event

  @unit
  Scenario: The evaluation trigger dispatches nothing past the span processing cap
    Given a span event on a trace whose span count has passed the span processing cap
    When the evaluation trigger runs
    Then no evaluation is dispatched

  @unit
  Scenario: The evaluation trigger declines a synthetic span before enqueue
    Given a synthetic span event on a trace with a resolved origin
    Then the evaluation trigger declines the event
