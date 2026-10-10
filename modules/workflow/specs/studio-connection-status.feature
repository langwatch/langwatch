Feature: The workflow studio shows one quiet connection status

  When the studio loses its engine connection it says so once, in the header,
  and keeps the user's work. Losing the connection is a pending state, not an
  error: no toast, no failed save, and no report of a run nobody started.

  @integration
  Scenario: A lost connection shows one reconnecting line
    Given the studio was connected to its engine
    When the connection drops for longer than a moment
    Then the header shows "Reconnecting…" with a status dot
    And no toast is raised for the connection

  @integration
  Scenario: A short wait for the connection shows nothing
    Given the studio is connecting to its engine
    When the connection comes back within a moment
    Then the header shows no connection line

  @integration
  Scenario: The connected line fades once the connection is back
    Given the header shows "Reconnecting…"
    When the connection comes back
    Then the header shows "Connected"
    And the line fades away shortly after

  @integration
  Scenario: Edits made while disconnected save when the connection returns
    Given the studio is disconnected
    When the user edits the workflow
    Then no save is attempted and no save failure is shown
    And the edit is saved once the connection returns

  @integration
  Scenario: A save that does not go through is retried, never shown as failed
    Given the studio is connected
    When an autosave does not go through
    Then no save failure is shown
    And the same change is saved on the next attempt

  @integration
  Scenario: The heartbeat never reports a run
    Given no run was started by the user
    When the engine's heartbeat answers with an error
    Then no run toast is raised
    And no running node is stopped
    And the connection status moves to reconnecting
