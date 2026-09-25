# Langy runs on the server and cannot see the tab. A dashboard widget renders
# inside a sandboxed frame the user's browser holds, so after the agent creates
# or edits a widget it has no way to tell whether the chart is empty, the labels
# read NaN, or an error panel is showing — "it compiled" is not "it looks right".
#
# The frame reports a render receipt (status, error text, the rendered #lw-root
# markup, height) to the host page; the page keeps the latest receipt per widget
# while its card is mounted and exposes it to the agent through the existing
# UI-action channel: `langwatch ui call dashboard.getWidgetRender`. The receipt
# lives only in an open tab — there is no saved state to answer from when none
# is attached.
Feature: A dashboard widget reports what it rendered so the agent can see it

  Background:
    Given a project with dashboard widgets placed on a dashboard

  @integration
  Scenario: A mounted widget reports a render receipt with its markup
    When a widget's frame mounts and paints its chart
    Then the frame reports a receipt whose status is ok
    And the receipt carries the rendered markup of the widget root

  @unit
  Scenario: A widget that fails to compile or throws reports an error receipt
    When the widget's code fails to compile or throws while rendering
    Then the frame reports a receipt whose status is error
    And the receipt carries the error text

  @integration
  Scenario: A receipt follows the widget's data
    Given a widget that has already reported a receipt
    When a query result arrives and the chart re-renders
    Then the frame reports an updated receipt for the new markup

  @integration
  Scenario: The dashboard page keeps the latest receipt per widget
    When a widget reports a receipt
    Then the page holds it keyed by the widget id
    And a later receipt for the same widget replaces the earlier one
    And the receipt is dropped when the widget's card leaves the grid

  @integration
  Scenario: The dashboard page clears stale receipts when the frame cannot be rendered
    Given a widget that has already reported a receipt
    When the widget's graph definition becomes invalid and its frame can no longer render
    Then the page clears that widget's stored receipt
    And the agent is not shown a stale receipt for it

  @unit
  Scenario: Langy reads one widget's receipt with its markup
    Given the user has the dashboard open and an agent turn is running
    When the agent calls dashboard.getWidgetRender for one widget id
    Then it receives that widget's status, error text and rendered markup

  @unit
  Scenario: Langy lists every widget on the open dashboard without markup
    Given the user has the dashboard open and an agent turn is running
    When the agent calls dashboard.getWidgetRender with no widget id
    Then it receives every widget on the dashboard without their markup

  @unit
  Scenario: With no browser attached the action answers that no page is open
    Given no page is attached for the conversation
    When the agent calls dashboard.getWidgetRender
    Then the dispatch is refused with langy_ui_no_browser
    And nothing is answered from saved state, because a receipt exists only in an open tab

  @integration
  Scenario: An oversized render receipt is clamped and flagged
    When the frame posts markup larger than the receipt size cap
    Then the receipt markup is truncated to the cap
    And the receipt's isMarkupTruncated flag is set to true

  @integration
  Scenario: A malformed render receipt is dropped
    When the frame posts a message with an invalid status or malformed markup
    Then the malformed message is discarded
    And the host never receives an invalid receipt

  @integration
  Scenario: Rapid render receipts are throttled to the latest
    When the frame posts multiple receipts in quick succession
    Then the host throttles to at most one receipt per 100ms
    And the delivered receipt carries the latest payload
