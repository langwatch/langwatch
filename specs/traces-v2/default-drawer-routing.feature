# Trace Explorer default routing — Gherkin Spec
# Implementation: platform/app/src/hooks/useDrawer.ts (routeTraceDrawerForV2 +
# the openDrawer interception), the legacy path redirects under
# platform/app/src/pages/[project]/messages/, and the legacy drawer redirect
# in platform/app/src/components/LegacyTraceDrawerRedirect.tsx
#
# The Trace Explorer is the default trace experience. The former per-device
# opt-in is gone: every request to open a trace's details (no matter which
# screen triggered it — evaluation results, a workflow run panel, the command
# bar, a feedback row) goes through the same open-drawer call, which routes to
# the Trace Explorer drawer.
#
# Both legacy surfaces are gone. The legacy Traces page path survives as a
# redirect to the Trace Explorer, and the legacy trace drawer name survives as
# a redirect to the Trace Explorer drawer — links shared before the change name
# `drawer.open=traceDetails` outright, and the drawer shell is resolved straight
# from the address, so the name has to keep resolving to something.
#
# The trace DETAIL view those links used to render is not gone: the simulation
# run drawer renders the same component, so removing the legacy drawer removes
# the drawer shell around it, not the view.

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

  Rule: The legacy Traces page is gone and its path redirects

    @integration
    Scenario: The legacy Traces path lands on the Trace Explorer
      Given I have a bookmark to the legacy Traces page
      When I open the bookmark
      Then I land on the Trace Explorer

    @integration
    Scenario: A filtered legacy Traces link keeps what it was filtered by
      Given I have a link to the legacy Traces page carrying filters
      When I open the link
      Then I land on the Trace Explorer
      And the link's filters are still in the address

    @integration
    Scenario: The sidebar no longer offers the legacy Traces page
      When I look at the project sidebar
      Then Trace Explorer is the only traces entry

  Rule: The legacy trace drawer is gone and links naming it redirect

    @integration
    Scenario: A link naming the legacy trace drawer opens the Trace Explorer drawer
      Given I opened a link that names the legacy trace drawer
      Then the Trace Explorer drawer opens for that trace
      And the legacy trace view is not rendered

    # The Trace Explorer drawer is mounted on every page, so there is no reason
    # to move the reader to the traces list to show them the trace they asked
    # for. A legacy drawer link opened from an annotation queue stays there.
    @integration
    Scenario: The redirect leaves the reader on the page the link was opened on
      Given I am on a page that is not the Trace Explorer
      When I open a link that names the legacy trace drawer
      Then the Trace Explorer drawer opens for that trace
      And I am still on the page I opened the link on

    @integration
    Scenario: A legacy drawer link naming a span keeps the span selected
      Given I opened a link that names the legacy trace drawer and a span
      Then the Trace Explorer drawer opens for that trace
      And the linked span is selected

    # Replacing rather than pushing: a pushed redirect puts the legacy address
    # in history, so going back would land on it and be redirected forward
    # again, trapping the reader.
    @integration
    Scenario: Going back from a redirected legacy link does not return to it
      Given I opened a link that names the legacy trace drawer
      When I close the Trace Explorer drawer
      Then the legacy drawer does not reopen

  Rule: Non-trace drawers and incomplete requests are never rerouted

    @integration
    Scenario: Opening a non-trace drawer is unaffected
      When a screen opens a drawer that is not a trace drawer
      Then that drawer opens unchanged

    # There is nothing to show and nothing to redirect to, so the drawer is
    # dismissed rather than left as an empty shell the reader has to close.
    @integration
    Scenario: A trace request without a trace id opens no drawer
      When a screen requests the trace drawer without a trace id
      Then no trace drawer is left open

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
