Feature: Legacy Slack webhook alert message building

  Triggers without a custom template dispatch a plain-text Slack message built
  from the matched traces: link, input, output, and event details. Trace
  content is customer data with no size bound, but Slack rejects oversized
  webhook payloads with a terminal 400, which would dead-letter the alert.
  The builder therefore bounds every piece of interpolated trace content.

  See specs/event-sourcing/dispatch-error-contract.feature for how a failed
  post is classified and surfaced.

  Scenario: Oversized trace content is truncated, not dropped
    Given a trigger matches a trace whose input or output exceeds the per-field limit
    When the Slack message is built
    Then the field is truncated with an ellipsis rather than interpolated in full
    And the alert still dispatches instead of being rejected by Slack for size

  Scenario: Event metric and detail values are bounded too
    Given a matched trace carries events with oversized metric or detail values
    When the Slack message is built
    Then each value is truncated to the per-field limit

  Scenario: Entry keys and the trigger's own name and message are bounded
    Given a matched trace carries an oversized metric or detail key
    Or the trigger's name or message is oversized
    When the Slack message is built
    Then each is truncated to its limit and escaped like any other interpolated field

  Scenario: A high-cardinality trace does not multiply into an oversized message
    Given a matched trace carries far more events, metrics, or details than an
    operator could read in an alert
    When the Slack message is built
    Then only the first entries of each are interpolated
    So that message size stays proportional to a trace rather than to its cardinality

  Scenario: The assembled message is bounded, not just its fields
    Given the built message would exceed Slack's size limit anyway — because
    escaping inflates content after it was truncated, and every trace, event,
    and entry multiplies the field count
    When the Slack message is dispatched
    Then the whole message is truncated to the byte budget with a clear marker
    And the alert still dispatches instead of being rejected by Slack for size
