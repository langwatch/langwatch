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
  Scenario: Autosave keeps saving while the engine is away
    Given the studio's engine connection is down
    When the user edits the workflow
    Then the edit is saved to the API as usual

  @integration
  Scenario: Run waits for the engine connection
    Given the studio's engine connection is not up
    When the user looks at a node's run control
    Then it is disabled with the tooltip "Waiting for the engine to connect"
    And no "Studio is not connected yet" toast is raised

  @integration
  Scenario: A save that does not go through is retried, never shown as failed
    Given the studio is open
    When an autosave to the API does not go through
    Then no save failure is shown
    And the same change is saved on the next attempt

  @integration
  Scenario: The heartbeat never reports a run
    Given no run was started by the user
    When the engine's heartbeat answers with an error
    Then no run toast is raised
    And no running node is stopped
    And the connection status moves to reconnecting

  @integration
  Scenario: Run in the expanded input panel waits for the engine
    Given the studio's engine connection is not up
    When the user opens a node's expanded input panel
    Then its Run button is disabled with the tooltip "Waiting for the engine to connect"
    And "Reconnecting…" shows beside the button
    And no toast is raised

  # A run's access (its short-lived key) is set up by the worker; while the worker catches up the
  # api answers "authz_grant_not_confirmed". That is pending too: wait and send again, never flash an error.
  @integration
  Scenario: The studio resends a run whose access is still being set up
    Given starting a run answers "authz_grant_not_confirmed"
    When the studio sends the run
    Then the same event is sent again every 5 seconds
    And no error toast is raised

  @integration
  Scenario: The studio stops resending after a minute and shows the error
    Given starting a run keeps answering "authz_grant_not_confirmed"
    When the studio has sent the same event again 12 times
    Then it stops resending
    And the usual error for a run that could not start is shown
