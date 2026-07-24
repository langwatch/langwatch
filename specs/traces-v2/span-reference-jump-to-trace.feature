# Span reference buttons — jump to the Trace tab and open the span
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/ExceptionsContent.tsx            (header exceptions)
#   langwatch/src/features/traces-v2/components/TraceDrawer/traceAccordions/TraceSummaryAccordions.tsx  (summary tab)
#   langwatch/src/features/traces-v2/components/TraceDrawer/waterfallView/WaterfallView.tsx   (selected span)
#   langwatch/src/features/traces-v2/stores/drawerStore.ts  (viewMode, selectSpan)
#
# Motivation (round 5): span reference buttons (an error span in the
# header, eval/event/exception spans in the Summary tab, span refs in the
# Conversation tab) call `selectSpan(spanId)` today — which updates the
# selection but leaves you on whatever tab you were on. The selected span
# only lives in the Trace tab's waterfall, so the click appears to do
# nothing. Clicking a span reference should take you to the span: switch
# to the Trace tab and open it.

Feature: Span reference jump to Trace tab

Rule: Clicking a span reference switches to the Trace tab and opens the span
  Regardless of which tab the reference was clicked from, the drawer
  lands on the Trace tab with that span selected and its detail visible.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open
    And the trace has at least one span referenced from another tab

  Scenario: From the drawer header (error span)
    Given the drawer header shows an error span reference
    When the user clicks the error span reference
    Then the drawer switches to the Trace tab
    And that span is selected in the waterfall
    And the span detail pane shows it (expanding if it was collapsed)

  Scenario: From the Summary tab (exception / eval / event span)
    Given the user is on the Summary tab with a span reference visible
    When the user clicks the span reference
    Then the drawer switches to the Trace tab
    And that span is selected in the waterfall
    And the span detail pane shows it (expanding if it was collapsed)

  Scenario: From the Conversation tab
    Given the user is on the Conversation tab with a span reference visible
    When the user clicks the span reference
    Then the drawer switches to the Trace tab
    And that span is selected in the waterfall
    And the span detail pane shows it (expanding if it was collapsed)

  Scenario: Already on the Trace tab
    Given the user is on the Trace tab
    When the user clicks a span reference
    Then the tab does not change
    And the referenced span becomes the selected span
    And the span detail pane shows it (expanding if it was collapsed)
