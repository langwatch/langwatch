# Conversation turn ledger — the per-turn separator line
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/ChatTurnRow.tsx
#   langwatch/src/features/traces-v2/utils/formatters.ts (formatRelativeTimeAgo)
#
# Motivation: a customer found the separator between conversation turns too
# busy and cryptic — "TURN 3 · small · 20.9s · 4.5K→538 · 1h" plus a "12.5s
# gap" divider above it. The model abbreviation ("small") and the raw
# input→output token count read as noise in a reading view, the bare "1h"
# was ambiguous (elapsed? remaining?), and the gap divider added a second
# confusing number. The ledger is trimmed to what helps while reading the
# conversation.

Feature: Conversation turn ledger

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open in Conversation mode with multiple turns

  Rule: The turn separator shows only scannable, unambiguous fields

    Scenario: The separator keeps duration and a clear relative time
      Given a turn that ran 20.9s and happened an hour ago
      Then its separator shows "20.9s"
      And it shows the relative time as "1h ago", not a bare "1h"

    Scenario: The model abbreviation is dropped from the separator
      Given a turn whose assistant used a specific model
      Then the separator does not repeat the model abbreviation
      # The model still labels the assistant bubble itself; the ledger line
      # doesn't duplicate it.

    Scenario: The raw token count is dropped from the separator
      Given a turn with 4500 input and 538 output tokens
      Then the separator does not show a "4.5K→538" token figure

  Rule: No inter-turn gap divider

    Scenario: Consecutive turns render without a gap divider
      Given two turns separated by several seconds of wall-clock time
      Then no "Xs gap" divider is drawn between them
