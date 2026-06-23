# Filter bar interactions — caret placement + clear-all
#
# Implementation:
#   langwatch/src/features/traces-v2/components/SearchBar/TokenValuePicker.tsx
#   langwatch/src/features/traces-v2/components/SearchBar/SearchBar.tsx
#   langwatch/src/features/traces-v2/components/SearchBar/SearchBarIndicators.tsx
#   langwatch/src/features/traces-v2/components/FilterSidebar/FilterSidebar.tsx
#   langwatch/src/features/traces-v2/components/FilterSidebar/FacetSection.tsx (row-order freeze)
#   langwatch/src/features/traces-v2/stores/filterStore.ts   (clearAll)
#   langwatch/src/features/traces-v2/stores/viewStore.ts     (revertLens, isDraft — reset to lens)
#
# Related specs:
#   specs/traces-v2/data-layer.feature   — owns the clearAll mechanism (AST + dependent state reset)
#   specs/traces-v2/view-system.feature  — "Revert local changes" is the same revertLens op on the lens menu;
#                                          keep "Reset to lens" terminology + behaviour aligned with it
#
# Motivation: filter-bar papercuts.
#   1. (round 5) Clicking a filter chip opens the value picker, whose search
#      input grabs focus on mount (`autoFocus`) and lands the caret at the
#      end so a click *into the middle* of an existing value can't position
#      the caret — the focus-on-mount fights the click.
#   2. (round 5) There's a clear affordance for the search text, but no
#      single "clear everything" control that also drops the facet-sidebar
#      selections, so resetting a complex filter is fiddly.
#   3. (round 6) "Clear" empties everything — but a lens (Errors,
#      Token-Heavy Traces…) ships its own default filter/sort, so emptying
#      strands the user off their lens with no quick way back. Add a
#      distinct "Reset to lens" control that restores the active lens's
#      defaults, kept separate from "Clear" so the two intents don't blur.

Feature: Filter bar interactions

Rule: The value picker prefills the current value, editable, alongside the full list
  Clicking a chip opens the picker with its input focused AND prefilled with
  the chip's current value (selected), so you can retype it, tweak it
  mid-text, or pick a different value from the full list below — editing the
  value as text and the dropdown are both available. Focus must not steal a
  deliberate click — clicking at a position inside the input lands the caret
  there rather than snapping to the end.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the search bar has a categorical filter chip (e.g. `model:gpt-5-mini`)

  Scenario: Opening the picker prefills the current value, selected for editing
    When the user clicks the filter chip
    Then the value picker opens
    And its input is focused and prefilled with the current value, selected
    And the current value's row is highlighted in the list

  Scenario: The full alternatives list shows until the value is edited
    When the user clicks the filter chip
    Then the picker lists all values for the field, not just the current one
    # Prefilling the input must not pre-filter the list down to the current value.

  Scenario: Editing the text narrows the list and offers the typed value
    Given the value picker is open prefilled with the current value
    When the user replaces the text with something new
    Then the list narrows to matches of what was typed
    And a "use as <field>:<typed>" row commits the typed text verbatim

  Scenario: Clicking mid-text positions the caret at the click point
    Given the value picker is open with text in its input
    When the user clicks between two characters in the input
    Then the caret lands at that click position
    And focus is not yanked back to the end of the input

Rule: A clear-all control resets every active filter
  The clear-all affordance is visible on the filter bar whenever any
  filter is active — search text OR facet-sidebar selections — and a
  single click returns the view to unfiltered.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Clear-all is hidden when nothing is filtered
    Given no search text and no facet selections are active
    Then no clear-all control is shown on the filter bar

  Scenario: Clear-all appears when any filter is active
    Given the user has typed a search query OR selected a facet value
    Then a clear-all control is shown on the filter bar

  Scenario: Clear-all resets search text and facet selections together
    Given the user has both a search query and one or more facet selections
    When the user activates the clear-all control
    Then the search query is emptied
    And all facet-sidebar selections are deselected
    And the trace list returns to its unfiltered result set
    # "Clear" empties to a blank query — it does NOT restore the lens's
    # default filter (that's "Reset to lens", below).

Rule: A "Reset to lens" control restores the active lens's defaults
  Distinct from "Clear": "Clear" empties everything, "Reset to lens"
  restores the active lens's saved filter/sort/columns. It is shown only
  when the current view deviates from the lens (a local draft exists), so
  the two controls don't compete when there's nothing to undo.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Reset-to-lens is hidden when the view matches the lens
    Given the active view matches its lens with no local changes
    Then no "Reset to lens" control is shown

  Scenario: Reset-to-lens appears once the view deviates
    Given the user has changed the filter, sort, or columns away from the lens
    Then a "Reset to lens" control is shown
    And it names the active lens (e.g. "Reset to Errors")

  Scenario: Reset-to-lens restores the lens defaults, not a blank query
    Given the active lens is "Errors" (default filter `status:error`)
    And the user has edited the query away from that default
    When the user activates "Reset to lens"
    Then the lens's default filter, sort, and columns are restored
    And the query is the lens default, not empty

  Scenario: Clear and Reset-to-lens are separate controls
    Given the active view deviates from a lens with a non-empty default
    Then both a "Clear" and a "Reset to lens" control are available
    And "Clear" empties the query while "Reset to lens" restores the lens

Rule: Facet rows hold their position while the pointer is in the section
  Clicking a facet value toggles its state but must not reorder the list
  under the cursor. The active value used to jump up to the pinned area, and
  the post-filter count re-sort shuffled the rest — jarring mid-click. The
  section freezes its row order while the pointer is inside it and only
  re-flows (pinning actives, re-sorting by count) once the pointer leaves.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a facet section is showing its values

  @integration
  Scenario: A facet value keeps its row position while the pointer is in the section
    Given the pointer has entered the facet section
    When a value in the list is toggled active
    Then the value keeps its row position instead of jumping to the pinned area
    And the value is shown as active in place

  @integration
  Scenario: Active facet values reflow to the pinned area once the pointer leaves
    Given a value was toggled active while the pointer was inside the section
    When the pointer leaves the section
    Then the active value moves up to the pinned area

  # The per-section value-search input lives inside the same hover-Box that
  # triggers the freeze, so naive freeze-on-hover would keep showing the
  # pre-search snapshot while the live list narrows. Search bypasses the
  # freeze; reorder-on-click (the freeze's actual purpose) is untouched.

  @integration
  Scenario: Value search narrows the list live even while the layout would otherwise be frozen
    Given the pointer has entered the facet section
    And the user opens the section's value-search input
    When the user types a substring that matches a subset of the values
    Then only the matching rows are shown

  @integration
  Scenario: Empty-state hint and rendered rows agree when no values match
    Given the pointer has entered the facet section
    And the user opens the section's value-search input
    When the user types a substring that matches no values
    Then no value rows are rendered
    And the "No match" hint is shown alone
