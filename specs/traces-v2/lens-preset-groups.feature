# Built-in lens preset groups — Cost & Performance dropdowns
#
# Implementation:
#   langwatch/src/features/traces-v2/stores/viewStore.ts        (builtInLenses, lens-group id sets, selectLens)
#   langwatch/src/features/traces-v2/components/Toolbar/LensTabs.tsx  (lens-group dropdown UI)
#
# Related specs:
#   specs/traces-v2/view-system.feature     — lens system (tabs, drafts, persistence); owns shared built-in behaviour
#   specs/traces-v2/grouping-engine.feature — the by-conversation grouping these conversation lenses use
#
# Motivation: the lens strip mixed dimensions and was running out of room.
# Round 5 folded the two cost views under one "Expensive" dropdown. Round 6
# generalises that into named dimension groups and broadens coverage:
#   - A "Cost" dropdown holding the expensive views.
#   - A "Performance" dropdown holding the slow + token + turn views, so
#     "Slow Traces" moves off the flat strip and joins its siblings.
#   - Built-in lens names use Title Case ("Expensive Traces"), and the
#     dropdown shows the full lens name (the group word is the trigger).
#
# Decisions:
#   - Group trigger labels are the dimension: "Cost", "Performance".
#   - Cost: Expensive Traces (cost desc, flat), Expensive Conversations
#     (cost desc, by-conversation).
#   - Performance: Slow Traces (duration desc, flat), Token-Heavy Traces
#     (tokens desc, flat), Token-Heavy Conversations (tokens desc,
#     by-conversation), Longest Conversations (turns desc, by-conversation).
#   - The flat strip keeps All, Simplified, Conversations, Errors.

Feature: Lens preset groups

Rule: Cost and Performance render as dimension dropdowns, not flat tabs
  Background:
    Given the user is authenticated with "traces:view" permission
    And the lens bar is shown

  Scenario: The grouped lenses are not flat tabs
    Then the flat lens tabs are All, Simplified, Conversations, and Errors
    And a "Cost" dropdown trigger is shown
    And a "Performance" dropdown trigger is shown
    And neither "Slow Traces" nor the expensive/token/turn lenses appear as flat tabs

  Scenario: The Cost dropdown lists its views by full name
    When the user opens the "Cost" dropdown
    Then it offers "Expensive Traces", "Large Traces", and "Expensive Conversations"

  Scenario: The Performance dropdown lists its views by full name
    When the user opens the "Performance" dropdown
    Then it offers "Slow Traces", "Token-Heavy Traces", "Token-Heavy Conversations", and "Longest Conversations"

  Scenario: A group trigger reads active when one of its lenses is selected
    Given the user has selected "Token-Heavy Traces"
    Then the "Performance" trigger is shown as active
    And no flat tab is shown as active

Rule: Cost lenses sort by their cost dimension, descending
  # The Cost dropdown holds spend views (cost) and the storage-size view
  # (Large Traces), since stored payload size is the storage-cost dimension.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the lens bar is shown

  Scenario: Expensive Traces — cost desc, flat
    When the user selects Cost → Expensive Traces
    Then the trace list is sorted by cost, descending
    And the rows are ungrouped (flat)

  Scenario: Large Traces — storage size desc, flat
    When the user selects Cost → Large Traces
    Then the trace list is sorted by storage size, descending
    And the rows are ungrouped (flat)
    And the Storage size column is shown

  Scenario: Expensive Conversations — cost desc, by conversation
    When the user selects Cost → Expensive Conversations
    Then the list is grouped by conversation
    And the groups are sorted by cost, descending

Rule: Performance lenses sort by their dimension, descending
  Background:
    Given the user is authenticated with "traces:view" permission
    And the lens bar is shown

  Scenario: Slow Traces — duration desc, flat
    When the user selects Performance → Slow Traces
    Then the trace list is sorted by duration, descending
    And the rows are ungrouped (flat)

  Scenario: Token-Heavy Traces — tokens desc, flat
    When the user selects Performance → Token-Heavy Traces
    Then the trace list is sorted by total tokens, descending
    And the rows are ungrouped (flat)

  Scenario: Token-Heavy Conversations — tokens desc, by conversation
    When the user selects Performance → Token-Heavy Conversations
    Then the list is grouped by conversation
    And the groups are sorted by total tokens, descending

  Scenario: Longest Conversations — turns desc, by conversation
    When the user selects Performance → Longest Conversations
    Then the list is grouped by conversation
    And the groups are sorted by turn count, descending
