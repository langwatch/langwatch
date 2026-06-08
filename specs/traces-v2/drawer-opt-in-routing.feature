# Trace drawer opt-in routing — Gherkin Spec
# Implementation: langwatch/src/hooks/useDrawer.ts (routeTraceDrawerForV2 +
# the openDrawer interception) and
# langwatch/src/features/traces-v2/hooks/useTracesV2Preference.ts
#
# The new Trace Explorer ("traces v2") ships behind a per-device opt-in: the
# operator clicks "Try the new one" once and every trace they open from then
# on should use the new drawer until they switch back. The opt-in is a
# per-browser choice, independent of the rollout feature flag that decides
# whether the opt-in affordance is even offered.
#
# The opt-in is honored at a single chokepoint: every request to open a
# trace's details (no matter which screen triggered it — the traces table,
# evaluation results, a workflow run panel, the command bar, a feedback row)
# goes through the same open-drawer call, which routes to the new explorer
# when the device opted in. This is why a single mechanism covers all
# entry points rather than each screen re-implementing the choice.

Feature: Trace drawer honors the new-explorer opt-in from every entry point
  As an operator who opted into the new Trace Explorer
  I want every "view trace" button across the product to open the new drawer
  So that my choice is respected everywhere, not just on the traces table

  Background:
    Given I am logged into a project

  Rule: The device opt-in routes all trace views to the new explorer

    @integration
    Scenario: A trace opened from a results view uses the new explorer when the device opted in
      Given I have opted into the new Trace Explorer on this device
      When I open a trace's details from a results view
      Then the new Trace Explorer drawer opens for that trace

    @integration
    Scenario: A trace opened from a results view uses the legacy drawer when the device has not opted in
      Given I have not opted into the new Trace Explorer on this device
      When I open a trace's details from a results view
      Then the legacy trace drawer opens for that trace

    @integration
    Scenario: The opt-in applies to every trace entry point, not only the traces table
      Given I have opted into the new Trace Explorer on this device
      When I open a trace's details from any screen
      Then the new Trace Explorer drawer opens for that trace

  Rule: Non-trace drawers and incomplete requests are never rerouted

    @integration
    Scenario: Opening a non-trace drawer is unaffected by the opt-in
      Given I have opted into the new Trace Explorer on this device
      When a screen opens a drawer that is not a trace drawer
      Then that drawer opens unchanged

    @integration
    Scenario: A trace request without a trace id is left on the legacy drawer
      Given I have opted into the new Trace Explorer on this device
      When a screen requests the trace drawer without a trace id
      Then the legacy trace drawer opens

  Rule: Reported regressions are fixed at the shared chokepoint

    @integration
    Scenario: Viewing a trace from evaluation results honors the opt-in
      Given I have opted into the new Trace Explorer on this device
      When I click "View" on a row in the evaluation results table
      Then the new Trace Explorer drawer opens for that trace

    @integration
    Scenario: Viewing the full trace from a workflow run honors the opt-in
      Given I have opted into the new Trace Explorer on this device
      When I click "Full Trace" on a workflow execution result
      Then the new Trace Explorer drawer opens for that trace

  Rule: Switching back returns to the legacy drawer

    @planned
    Scenario: Opting back out from the new explorer returns later trace views to the legacy drawer
      Given I have opted into the new Trace Explorer on this device
      And I switch back to the legacy drawer from the new explorer's menu
      When I open a trace's details from a results view
      Then the legacy trace drawer opens for that trace
