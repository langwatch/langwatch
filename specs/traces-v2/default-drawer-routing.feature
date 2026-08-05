# Trace Explorer default routing — Gherkin Spec
# Implementation: platform/app/src/hooks/useDrawer.ts (routeTraceDrawerForV2 +
# the openDrawer interception) and the legacy deprecation banner in
# platform/app/src/components/messages/LegacyTracesDeprecationBanner.tsx
#
# The Trace Explorer is the default trace experience. The former per-device
# opt-in is gone: every request to open a trace's details (no matter which
# screen triggered it — evaluation results, a workflow run panel, the command
# bar, a feedback row) goes through the same open-drawer call, which routes to
# the Trace Explorer drawer. The legacy Traces page remains reachable only
# through its sidebar entry, keeps its legacy drawer so the view stays
# coherent, and warns that it is going away.

Feature: Trace Explorer is the default trace experience from every entry point
  As an operator viewing traces
  I want every "view trace" action across the product to open the Trace Explorer
  So that I get the current experience everywhere without opting in

  Background:
    Given I am logged into a project

  Rule: All trace views open the Trace Explorer drawer by default

    @integration
    Scenario: A trace opened from a results view uses the Trace Explorer
      When I open a trace's details from a results view
      Then the Trace Explorer drawer opens for that trace

    @integration
    Scenario: The default applies to every trace entry point, not only the traces table
      When I open a trace's details from any screen
      Then the Trace Explorer drawer opens for that trace

    @integration
    Scenario: A trace ID searched in the command bar opens in the Trace Explorer
      When I search for a trace ID in the command bar and select the result
      Then the Trace Explorer opens with that trace's drawer

  Rule: The legacy Traces page is the only place that keeps the legacy drawer

    @integration
    Scenario: Opening a trace from the legacy Traces page uses the legacy drawer
      Given I navigated to the legacy Traces page from the sidebar
      When I open a trace's details from the legacy traces table
      Then the legacy trace drawer opens for that trace

    @integration
    Scenario: The legacy Traces page warns that it is going away
      When I visit the legacy Traces page
      Then I see a notice that this view is going away soon
      And the notice offers to open the Trace Explorer

    @integration
    Scenario: The legacy trace drawer warns that it is going away
      Given I navigated to the legacy Traces page from the sidebar
      When I open a trace's details from the legacy traces table
      Then the legacy drawer shows a notice that this view is going away soon
      And the notice can open the same trace in the Trace Explorer

  Rule: Non-trace drawers and incomplete requests are never rerouted

    @integration
    Scenario: Opening a non-trace drawer is unaffected
      When a screen opens a drawer that is not a trace drawer
      Then that drawer opens unchanged

    @integration
    Scenario: A trace request without a trace id is left on the legacy drawer
      When a screen requests the trace drawer without a trace id
      Then the legacy trace drawer opens

  Rule: Old trace links land on the Trace Explorer

    @integration
    Scenario: A legacy trace deep link opens the Trace Explorer
      Given I received a link to a trace under the legacy traces path
      When I open the link
      Then I land on the Trace Explorer with that trace's drawer open

    @integration
    Scenario: A legacy span deep link opens the Trace Explorer with the span selected
      Given I received a link to a span under the legacy traces path
      When I open the link
      Then I land on the Trace Explorer with that trace's drawer open
      And the linked span is selected

    @integration
    Scenario: Notification links point at the Trace Explorer trace path
      When a trigger notification includes a link to a trace
      Then the link opens the Trace Explorer with that trace's drawer open

    @integration
    Scenario: A malformed trace link lands on not-found instead of a blank page
      Given I received a trace link that is missing its project or trace id
      When I open the link
      Then I land on the not-found page
