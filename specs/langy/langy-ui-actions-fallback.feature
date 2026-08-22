# The away half of the UI-action channel: the same verbs keep working when no
# page answers, and the page reconciles when it comes back.
#
# The dispatch decides the fallback on its own: every action publishes to the
# live stream, and an action unclaimed after the claim window falls back. The
# claim window is the only authority on whether a page is attached: presence
# cannot answer this, because its heartbeat mounts per view and a page
# without it reads as "nobody home" forever. The pending record is deleted
# BEFORE the backend executes, so a tab waking up late finds nothing to claim
# and the backend execution stays the only execution. The backend applies the
# SAME transform to the SAVED workbench state through the server-owned seam,
# so every fallback write is validated, versioned, and attributed to Langy.
#
# Reconciliation is one rule applied to two signals (the experiment_updated
# broadcast and a version probe when the tab returns): a CLEAN workbench
# reloads silently, a DIRTY one banners and the user decides, because a reload
# discards their edits. The autosave compare-and-set is the third leg: a save
# refused as stale stands autosave down until the user reloads.
Feature: Langy UI actions fall back to the backend and the page catches up

  @unit
  Scenario: With no browser attached the same verb executes on the backend transparently
    Given no live tab is present for the project
    When the agent dispatches a workbench action
    Then nothing is published and the backend applies it to the saved state
    And the result names executedVia backend

  @unit
  Scenario: An unclaimed action falls back to the backend after the claim window
    Given a live tab exists but never claims the published action
    When the claim window lapses
    Then the pending record is deleted before the backend executes

  @unit
  Scenario: A claimed but silent action times out and never double-executes
    Given a page claimed the action and reported nothing
    When the execute budget lapses
    Then the dispatch answers langy_ui_timeout and the backend never runs

  @unit
  Scenario: A backend fallback without the experiment named is refused
    Given no page answered and the dispatch carried no experiment slug
    When the backend fallback would run
    Then the dispatch answers langy_ui_experiment_required

  @unit
  Scenario: A backend edit lands as a version attributed to Langy
    Given the backend fallback applies a transform action
    When the save lands through the seam
    Then it echoes the version it read and records a version authored by Langy

  @unit
  Scenario: get-state falls back to the saved state when no browser is attached
    Given no page answered a workbench.getState dispatch
    When the backend serves the read
    Then the projection is marked source saved and carries the version

  @unit
  Scenario: A run started with no browser executes from the saved state
    Given no page answered a workbench.run dispatch
    When the backend starts the run
    Then it loads the saved state through the same path a CI run uses

  @integration
  Scenario: A backend edit refreshes an idle workbench automatically
    Given the workbench is open with no unsaved edits
    When a newer version lands for this experiment
    Then the page reloads the state silently and shows no banner

  @integration
  Scenario: A backend edit never clobbers a workbench with unsaved changes
    Given the workbench has unsaved edits
    When a newer version lands for this experiment
    Then the stale banner appears and nothing reloads until the user asks

  @integration
  Scenario: A returning tab detects staleness and reloads a clean workbench
    Given the tab was hidden while the server version advanced
    When the tab becomes visible again
    Then a version probe runs and the clean workbench reloads silently

  @integration
  Scenario: Autosave hitting a stale version pauses and offers reload
    Given another writer saved a newer version than this tab loaded
    When the tab's autosave sends its expected version
    Then the save is refused before anything is written
    And autosave stands down until the user reloads
