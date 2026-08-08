# Conversation turn ledger — the per-turn separator line
#
# Implementation:
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/ChatTurnRow.tsx
#   platform/app/src/features/traces-v2/utils/formatters.ts (formatRelativeTimeAgo)
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

  Rule: A turn that recorded events says how many

    The events a turn's spans recorded are worth scanning for while reading: a
    turn that recorded three of them reads differently from one that recorded
    none. Only the count is shown. The legacy thread view also drew the
    thumbs-up / thumbs-down vote an event carried, and the conversation's turn
    data holds no event metrics to draw it from, so that display is left out
    rather than guessed at.

    A turn arrives without its events, which are read back for the whole thread
    in one go, the same way the trace table reads them for a page.

    @integration
    Scenario: A turn with events shows how many it recorded
      Given a turn that recorded two events
      Then its separator shows "2 events"

    @integration
    Scenario: A single event reads in the singular
      Given a turn that recorded one event
      Then its separator shows "1 event"

    @integration
    Scenario: A turn with no events shows no events segment
      Given a turn that recorded no events
      Then its separator says nothing about events

    @integration
    Scenario: Each turn in a thread carries the events it recorded
      Given a conversation whose turns recorded different events
      When the thread reads its events back
      Then every turn carries its own count

    @integration
    Scenario: A turn still waiting on its events reports none
      Given a conversation whose events have not arrived yet
      Then no turn claims to have recorded any

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
