Feature: A moved family reports failures through its host, not a raw toast

  A feature-web package that imports the Design System toaster directly can
  raise a failure straight onto the toast singleton, bypassing the
  composition's code-keyed presentation registry and the trace id the
  boundary attaches. A screen reports a failure through its host port
  instead, or the family's own showErrorToast / useShowErrorToast re-binder.
  Success, info and warning notices may still use the toaster directly.

  @unit
  Scenario: A moved family reports a failure through its host, not the toaster
    Given a feature-web package that imports the Design System toaster
    When its source is scanned for a raised failure on the toaster singleton
    Then no line raises a failure directly on the toaster
    And any offending line is named by file and line number

  @unit
  Scenario: A moved family does not carry a toaster of its own
    Given a feature-web package that imports the Design System toaster
    When its source is scanned for a second, local toast renderer or copy surface
    Then no feature-web package carries one of its own
