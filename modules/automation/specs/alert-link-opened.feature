Feature: A member landing from an alert's link is counted

  The links an alert's email and default Slack message point at (a trace or a
  chart in our own app) carry the marker `lw_from=alert`. Webhook bodies and
  custom templates are sent byte for byte as before, without it. When a
  signed-in member opens a marked link, the app sends one
  `automations.opened.alert_link` event with the page it opened, then the router
  replaces the current history entry without the marker. The event carries no trace,
  chart or automation id and no URL.

  @unit
  Scenario: An alert link carries the marker in its query, before any hash
    Given links to our own app with no query, a query, a "#hash", and both
    When the alert marker is set
    Then each keeps its query and hash, with "lw_from=alert" in the query

  @unit
  Scenario: A link to another site, or no site, is left unchanged
    When the marker is set on a link to another site, a relative link or "#"
    Then the link is returned unchanged

  @unit
  Scenario: Slack's default message links to a trace carry the marker
    When the default Slack alert links a trace
    Then the link carries "lw_from=alert"

  @unit
  Scenario: Digest email links carry the marker
    When a digest email links a trace with a partition hint and a chart
    Then both links carry "lw_from=alert"

  @unit
  Scenario: Webhook bodies and custom templates carry no marker
    When a webhook body links a trace and a chart
    Then neither link carries "lw_from"

  @integration
  Scenario: Opening an alert link sends one event and replaces the marker out of history
    Given a signed-in member
    When they open "/demo/traces/trace-1?t=1&lw_from=alert#spans"
    Then one automations.opened.alert_link is sent with landedOn "trace"
    And the address becomes "/demo/traces/trace-1?t=1#spans" in the same history entry, keeping its state
    And no trace id or URL is in the event

  @integration
  Scenario: A later search update keeps the marker gone and sends nothing more
    Given a signed-in member opened "/demo/traces/trace-1?lw_from=alert"
    When the page sets its search to "q=errors"
    Then the address is "/demo/traces/trace-1?q=errors"
    And automations.opened.alert_link was sent once

  @integration
  Scenario: A page without the marker, or a signed-out reader, sends nothing
    When a signed-in member opens "/demo/traces/trace-1?t=1"
    Or a signed-out reader opens "/demo/traces/trace-1?lw_from=alert"
    Then no automations.opened.alert_link is sent
