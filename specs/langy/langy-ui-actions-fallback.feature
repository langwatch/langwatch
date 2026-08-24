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
  Scenario: An action no page picks up is still carried out, once
    Given a live tab exists but never takes the published action
    When the agent's action goes unanswered
    Then the change is applied without the page
    And a tab waking up late cannot apply it a second time

  @unit
  Scenario: A page that takes an action and goes quiet leaves nothing half done
    Given a page took the action and reported nothing
    When it stays silent past the time it was given
    Then the agent is told the action timed out
    And the change is never applied a second time behind the page

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
  Scenario: A run started with no browser covers what the workbench holds
    Given no page answered a workbench.run dispatch
    When the backend starts the run
    Then the run covers the same rows and columns the saved workbench shows

  @unit
  Scenario: A run started with no browser fills the cells the workbench shows
    Given no page answered a workbench.run dispatch
    When the backend starts the run
    Then the run writes its cells back into the saved workbench state

  @integration
  Scenario: A backend edit refreshes an idle workbench automatically
    Given the workbench is open with no unsaved edits
    When a newer version lands for this experiment
    Then the page reloads the state silently and shows no banner

  @integration
  Scenario: A backend edit never clobbers a workbench with unsaved changes
    Given the workbench has unsaved edits and autosave has stood down
    When a newer version lands for this experiment
    Then the stale banner appears and nothing reloads until the user asks

  # A tab with unsaved edits already has its own save coming, and that save's
  # answer is the truth: a new version, or a refusal. Bannering on the version
  # signal instead told the reader their work clashed with "somewhere else"
  # while Langy was driving THAT TAB, seconds before the tab's own save landed
  # and made the whole thing moot. The reader was interrupted by their own
  # keystrokes.
  @integration
  Scenario: A tab with a save on the way waits for its own answer
    Given the workbench has unsaved edits and a save on the way
    When a newer version lands for this experiment
    Then no banner appears, and the tab's own save decides what happens next

  # A save that failed leaves the workbench dirty and schedules no retry, so
  # there is no answer to wait for. Waiting anyway kept the tab silent about
  # every later version until the reader happened to type again.
  @integration
  Scenario: A tab whose autosave failed still hears the next version
    Given the workbench has unsaved edits and its last save failed
    When a newer version lands for this experiment
    Then the stale banner appears and nothing reloads until the user asks

  # Langy drives the open page, so most versions it announces are its own work
  # on the reader's behalf. "Somewhere else" reads as a stranger.
  @integration
  Scenario: A change Langy made is named as Langy's
    Given the server holds a newer version written by Langy
    When the tab probes the version after coming back into focus
    Then the banner names Langy rather than saying it happened somewhere else

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

  # The refusal is the path a dirty tab reaches the banner by, so it is the
  # path that most needs the name. The refusal itself says who holds the
  # newer version.
  @integration
  Scenario: A refused save names who holds the newer version
    Given Langy saved a newer version than this tab loaded
    When the tab's autosave is refused
    Then the banner names Langy rather than saying it happened somewhere else
