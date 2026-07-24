# Conversation view — per-message expand + expand all
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/ConversationView.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/ChatTurnRow.tsx        (ThreadMessage)
#   langwatch/src/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble.tsx  (shared bubble)
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/expandContext.ts
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/MessageExpandToggle.tsx
#
# Motivation (round 5): long messages in the conversation view are
# truncated with a bare "…" and no way to read the rest in place. Replace
# the ellipsis with a per-message Show more / Show less toggle, and add an
# "Expand all" control to the conversation toolbar. The Bubble is shared
# with the trace table's compact preview, which must keep its plain
# truncation — so the expand behaviour is gated on a context the
# conversation view provides and the table does not.

Feature: Conversation message expand

Rule: A truncated message offers a per-message expand toggle
  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on the Conversation tab

  Scenario: Long message shows "Show more" instead of a bare ellipsis
    Given a turn whose message is longer than the truncation limit
    Then the message renders truncated with a "Show more" toggle
    And it does not rely on a bare "…" as the only affordance

  Scenario: Expanding one message reveals its full text
    Given a truncated message with a "Show more" toggle
    When the user clicks "Show more"
    Then the full message text is shown
    And the toggle now reads "Show less"
    And clicking the toggle does not navigate to the turn

  Scenario: Short messages have no toggle
    Given a turn whose message is within the truncation limit
    Then the message is shown in full with no expand toggle

Rule: An "Expand all" toolbar control expands every message
  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on the Conversation tab in thread or bubbles mode

  Scenario: Expand all opens every truncated message
    When the user clicks "Expand all" in the conversation toolbar
    Then every truncated message in the conversation expands
    And the control now reads "Collapse all"

  Scenario: Collapse all returns messages to truncated
    Given the user has expanded all messages
    When the user clicks "Collapse all"
    Then every message returns to its truncated form

  Scenario: Expand-all is only offered for the message layouts
    Given the conversation is in markdown or annotations mode
    Then no expand-all control is shown

Rule: The table's compact preview is unaffected
  Scenario: Trace-table conversation bubbles keep plain truncation
    Given a conversation preview rendered in the trace table (no conversation-view context)
    Then long bubbles stay truncated with the existing ellipsis
    And no per-message expand toggle is shown
