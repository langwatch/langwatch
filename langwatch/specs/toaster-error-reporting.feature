Feature: Handled client errors reach PostHog via the toaster
  As an operator watching the client error-rate quality metric
  I want handled failures that show an error toast to also report to PostHog
  So that the metric reflects real user pain, not only uncaught crashes

  Context: audit of the "the truth" dashboard found that ~150 client catch
  blocks showed an error toast but never reported the error, so handled
  failures (failed uploads, saves, billing actions) were invisible to the
  $exception metric. The shared toaster now accepts an opt-in `error` field:
  passing the caught error forwards it to PostHog as a $exception. Validation
  toasts pass no error and stay silent — the presence of a real error is the
  signal, so we never report plain "field required" messages.

  @unit
  Scenario: An error toast that carries a caught error reports to PostHog
    Given a catch block calls toaster.create with type "error" and the caught error
    When the toast is created
    Then a "$exception" event is captured tagged source=toaster
    And the toast still renders unchanged

  @unit
  Scenario: A validation toast without an error stays silent
    Given a toaster.create call with type "error" and no error field
    When the toast is created
    Then no "$exception" event is captured
    And the toast renders normally

  @unit
  Scenario: Non-error toasts never report
    Given a toaster.create call with type "success", "info", or "loading"
    When the toast is created
    Then no "$exception" event is captured
