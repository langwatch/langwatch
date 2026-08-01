# Conversation turn ledger — the per-turn separator line
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/conversationView/ChatTurnRow.tsx
#   langwatch/src/features/traces-v2/utils/formatters.ts (formatRelativeTimeAgo)
#
# Motivation: a customer found the separator between conversation turns too
# busy and cryptic: "TURN 3 · small · 20.9s · 4.5K→538 · 1h". The model
# abbreviation ("small") and the raw input→output token count read as noise in
# a reading view, and the bare "1h" was ambiguous (elapsed? remaining?). The
# ledger is trimmed to what helps while reading the conversation. The "Xs gap"
# divider between turns is kept, because a long pause since the previous turn
# is meaningful context worth surfacing.

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

  Rule: A long inter-turn pause is surfaced as a gap divider

    A noticeable wall-clock gap since the previous turn finished is drawn as an
    "Xs gap" divider above the turn, so a reader sees where the conversation
    paused.

    Scenario: A long pause between turns draws a gap divider
      Given a turn that started 12.5s after the previous turn finished
      Then a "12.5s gap" divider is drawn above it

    Scenario: The first turn has no preceding gap
      Given the first turn in the conversation
      Then no gap divider is drawn above it
