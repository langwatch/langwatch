Feature: A member landing from an alert's link is counted

  An alert's own links (the trace or chart a notification points at, in a
  template, a Slack message or a digest email) carry the marker `lw_from=alert`.
  When a signed-in member opens one, the app sends one
  `automations.opened.alert_link` event with the page it opened, then drops the
  marker from the address. The event carries no trace, chart or automation id
  and no URL.

  @unit
  Scenario: An alert link carries the marker after any query it already has
    Given a trace link with the partition hint "?t=1700000000000"
    When the alert marker is added
    Then the link ends with "?t=1700000000000&lw_from=alert"
    And a link with no query ends with "?lw_from=alert"
    And a dead "#" link stays "#"

  @unit
  Scenario: Slack and template links to a trace or a chart carry the marker
    When a Slack alert or a notification template links a trace and a chart
    Then both links carry "lw_from=alert"

  @unit
  Scenario: Digest email links carry the marker
    When a digest email links a trace with a partition hint and a chart
    Then both links carry "lw_from=alert"

  @integration
  Scenario: Opening an alert link sends one event and drops the marker
    Given a signed-in member
    When they open "/demo/traces/trace-1?t=1&lw_from=alert"
    Then one automations.opened.alert_link is sent with landedOn "trace"
    And the address becomes "/demo/traces/trace-1?t=1"
    And no trace id or URL is in the event

  @integration
  Scenario: A page without the marker, or a signed-out reader, sends nothing
    When a signed-in member opens "/demo/traces/trace-1?t=1"
    Or a signed-out reader opens "/demo/traces/trace-1?lw_from=alert"
    Then no automations.opened.alert_link is sent
