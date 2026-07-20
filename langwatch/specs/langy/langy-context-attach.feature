Feature: Attaching context to Langy and showing what it holds
  As someone working across the app
  I want to hand Langy specific things to look at and see what it currently holds
  So that I trust exactly what Langy is working from, by human name — not raw ids

  # ---------------------------------------------------------------------------
  # Any surface (a home card, a trace row, a briefing receipt) can hand Langy a
  # piece of context through one small typed store API. The context Langy holds
  # lives in ONE place — the composer's own summary row, in both layouts —
  # named for humans (trace summary / first message / endpoint / model), with
  # the raw id kept as a secondary tooltip. A second strip above the
  # conversation restated the same chips and read as duplication.
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

  @unit
  Scenario: Attached context reaches the agent as page context
    Given a "trace" context item is attached
    When the next turn's request context is built
    Then the turn carries that trace as page context, deduplicated against derived chips

  @integration
  Scenario: The composer is the single home of held context
    Given Langy is holding context
    Then the composer's context row shows every held chip, in both layouts
    And no second context strip appears above the conversation

  @unit
  Scenario: Removing a chip clears every source it has
    Given a chip that is both page-derived and explicitly attached
    When the user removes it from the composer
    Then the derived chip is dismissed and the attachment is detached
    So the chip does not reappear from the other source

  @unit
  Scenario: A trace context chip is named for humans, with the id secondary
    Given a trace context chip whose only known payload is the raw trace id
    When its hover is shown
    Then the human-friendly trace name is the primary label
    And the raw trace id is shown as secondary detail

  @unit
  Scenario: The trace display name falls back through the fields the app already uses
    Given a trace with a resolved trace name
    Then the display name is the resolved trace name
    Given a trace with no resolved name but a root span name
    Then the display name is the root span name
    Given a trace with neither
    Then the display name is a shortened form of the trace id
