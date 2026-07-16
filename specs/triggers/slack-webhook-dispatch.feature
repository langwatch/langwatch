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
