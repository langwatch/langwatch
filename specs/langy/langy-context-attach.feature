Feature: Attaching context to Langy and showing what it holds
  As someone working across the app
  I want to hand Langy specific things to look at and see what it currently holds
  So that I trust exactly what Langy is working from, by human name — not raw ids

  # ---------------------------------------------------------------------------
  # Any surface (a home card, a briefing receipt) can hand Langy a piece of
  # context through one small typed store API. The context Langy holds lives in
  # ONE place, the composer's own summary row, in both layouts, named for
  # humans (trace summary / first message / endpoint / model), with the raw id
  # kept as a secondary tooltip. A second strip above the conversation restated
  # the same chips and read as duplication.
  #
  # The trace LIST hands context through an explicit multi-select action, NOT a
  # per-row hover: the dense table made a hover "Absorb context" affordance read
  # as noise. You check the rows you want, then "Add to context" in the
  # selection bar drops them all into Langy at once and opens the panel.
  #
  # SCOPE: this file is the STORE and the ENTRY POINTS. What the page offers on
  # its own, and how an offered chip is chosen or dropped, belong to
  # specs/langy/langy-context-awareness.feature and
  # specs/langy/langy-context-system.feature — the three overlap and want
  # consolidating.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A surface attaches a piece of context
    Given Langy holds no attached context
    When a surface attaches context of type "trace" with an id and a human label
    Then Langy's attached-context list contains exactly that item

  @unit
  Scenario: Attaching the same id twice does not duplicate it
    Given a "trace" context item is already attached
    When the same id is attached again with a refreshed label
    Then the list still holds one item for that id
    And it carries the refreshed label

  @unit
  Scenario: Detaching removes only the named item
    Given two context items are attached
    When one of them is detached by id
    Then only the other remains

  @unit
  Scenario: Attached context is cleared when the active project changes
    Given context is attached
    When the store resets for a new project
    Then no attached context remains

  # Both halves exist and are proven separately — the attached item becomes the
  # chip shape the agent speaks, and chips naming the same resource collapse —
  # but nothing walks an attached item all the way onto a turn's request
  # context, so the end-to-end claim is a gap, not a binding.
  @unit @unimplemented
  Scenario: Attached context reaches the agent as page context
    Given a "trace" context item is attached
    When the next turn's request context is built
    Then the turn carries that trace as page context, deduplicated against derived chips

  # Nothing renders the composer's context row, so neither the "every held chip,
  # both layouts" claim nor the absence of a second strip is asserted anywhere.
  @integration @unimplemented
  Scenario: The composer is the single home of held context
    Given Langy is holding context
    Then the composer's context row shows every held chip, in both layouts
    And no second context strip appears above the conversation

  @integration
  Scenario: The trace list adds context through the selection bar, not a hover
    Given a trace row is NOT a per-row Langy hover target
    And several trace rows are selected via their checkboxes
    When the user clicks "Add to context" in the selection bar
    Then every selected trace is attached to Langy, named for humans
    And the Langy panel opens so the held context is visible
    And the action is offered only when Langy is available and the selection is explicit

  @unit
  Scenario: A trace context chip is named for humans, with the id secondary
    Given a trace context chip whose only known payload is the raw trace id
    When its hover is shown
    Then the human-friendly trace name is the primary label
    And the raw trace id is shown as secondary detail

  # `traceContextChip` implements two branches — a supplied display name, else a
  # shortened id — and both are proven. The middle step, resolving a root span
  # name when the trace has no name of its own, happens at the call sites and is
  # asserted at none of them.
  @unit @unimplemented
  Scenario: The trace display name falls back through the fields the app already uses
    Given a trace with a resolved trace name
    Then the display name is the resolved trace name
    Given a trace with no resolved name but a root span name
    Then the display name is the root span name
    Given a trace with neither
    Then the display name is a shortened form of the trace id

  # REMOVED (contradicted by the shipped model): a scenario here used to say
  # that removing a chip "dismisses the derived chip and detaches the
  # attachment so it does not reappear from the other source". Context is now
  # opt-in — being on a page is an OFFER, and a chip the user drops stays on the
  # "+ context" control to be re-added. That behaviour is specified as
  # "Removed context can be added back from the add control" in
  # specs/langy/langy-context-system.feature.
