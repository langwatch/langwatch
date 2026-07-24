# Conversation context — remaining-turn counts
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/ConversationContext.tsx
#   langwatch/src/features/traces-v2/hooks (useConversationContext — position / total)
#
# Motivation (round 5): the Conversation Context pane shows the previous
# turn, the current turn, and the next turn, with a "Start of
# conversation" marker when there's nothing before. It already knows the
# current position and total ("turn N of M"), but it doesn't tell you how
# much conversation is hidden above/below the three-row window. Surface
# the remaining counts on each side, mirroring the start/end markers.

Feature: Conversation context remaining-turn counts

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on a trace that belongs to a conversation
    And the Conversation Context pane is visible

  Scenario: Turns hidden above are counted
    Given there is more than one turn before the visible previous turn
    Then the pane shows how many earlier turns are above the window
    # e.g. "N turns above" near the top of the context window

  Scenario: Turns hidden below are counted
    Given there is more than one turn after the visible next turn
    Then the pane shows how many later turns are below the window
    # e.g. "N turns below" near the bottom of the context window

  Scenario: Start of conversation still shows the boundary marker
    Given the current turn is the first turn in the conversation
    Then the "Start of conversation" marker is shown above
    And no "turns above" count is shown

  Scenario: End of conversation still shows the boundary marker
    Given the current turn is the last turn in the conversation
    Then the end-of-conversation marker is shown below
    And no "turns below" count is shown

  Scenario: Counts match the visible window for a specific turn position
    Given the header shows "turn 5 of 10"
    Then the pane shows "3 turns above"
    And the pane shows "4 turns below"
