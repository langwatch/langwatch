Feature: The no-failure-on-toaster and no-module-toaster lint rules
  A feature-web module (`modules/*/browser`, `enterprise/modules/*/browser`) reports a failure
  through its host port, so the words come from the code-keyed registry and the boundary attaches
  a trace id. `no-failure-on-toaster`: once a file imports `@langwatch/design-system/toaster`
  (named, renamed or as a namespace), every `<toaster>.error(...)` call and every `type: "error"`
  property, including one whose value is a const holding "error", is reported; success, info
  and warning notices are not. `no-module-toaster`: a `createToaster(...)` call is reported, and a
  module that exports `toaster` and never calls `.failed(...)` is reported at every
  `type: "error"`. Both replace the retired design-system scan with the same detection; tests are
  not governed, and there is no per-line marker.

  Rule: `langwatch/no-failure-on-toaster` and `langwatch/no-module-toaster` route every failure through the host port

  @unit
  Scenario: A failure raised on the Design System toaster is reported
    Given a feature-web file that imports the toaster and calls `.error`, creates a toast of type error, aliases the import, or builds the toast in a helper
    When the no-failure-on-toaster rule runs over it
    Then it reports failureOnToaster for each

  @unit
  Scenario: A failure reached through a namespace import or a const type is reported
    Given a feature-web file that imports the toaster module as a namespace and calls `.toaster.error`
    And a toast whose type is a const holding "error"
    When the no-failure-on-toaster rule runs over it
    Then it reports failureOnToaster for each

  @unit
  Scenario: Notices and files without the toaster import are accepted
    Given a feature-web file that raises success, info or warning notices, or raises a failure on a toaster it did not import from the Design System
    When the no-failure-on-toaster rule runs over it
    Then it reports nothing

  @unit
  Scenario: A local toaster that only routes to the host is accepted
    Given a module that exports a toaster which hands every failure to `host.failed`, or raises no failure at all, or only uses the Design System toaster
    When the no-module-toaster rule runs over it
    Then it reports nothing

  @unit
  Scenario: Code outside feature-web modules is not governed
    Given a test file and an apps/ui file that raise a failure on the toaster
    When the toaster rules run over them
    Then they report nothing

  @unit
  Scenario: A toaster finding says what to do instead
    Given a feature-web file that raises a failure on the toaster
    When the no-failure-on-toaster rule reports it
    Then the message names showErrorToast and the host port
