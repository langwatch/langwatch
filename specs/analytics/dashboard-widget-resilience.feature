Feature: Dashboard widgets recover from failures and stay current

  A dashboard widget runs its author's code inside a sandboxed frame, and the
  frame talks to the page over a heartbeat. Until now a frame that stopped
  responding was torn down and left showing a failure until somebody clicked
  Restart, an error the widget's own code raised was dropped on the floor,
  and nothing on a dashboard refreshed unless the period changed. A member
  watching a dashboard expects two things instead: a card that stops
  responding comes back on its own, and the numbers on screen are not
  older than the refresh interval they chose while the tab is open.

  Background:
    Given a project with dashboard widgets placed on a dashboard

  @integration
  Scenario: A frame that stops responding is restarted automatically
    When a widget's frame stops responding
    Then the widget restarts itself after a short pause
    And the member sees that it is restarting rather than a failure

  @integration
  Scenario: Restarts back off and stop after three attempts
    Given a widget's frame stops responding again after each restart
    When it has been restarted three times
    Then the widget waited longer before each attempt
    And after the third it stops retrying and says it restarted three times and is still not responding
    And a Restart button is still available to try again by hand

  @integration
  Scenario: A frame that stays healthy forgets earlier restarts
    Given a widget was restarted once
    When it stays responsive for a minute
    Then a later failure starts again from the first short pause

  @integration
  Scenario: Automatic restarts wait while the tab is hidden
    Given a widget's frame stops responding while the tab is in the background
    Then no restart happens until the member returns
    And the widget restarts as soon as the tab is visible again

  @integration
  Scenario: A widget's own error is shown, not dropped
    When a widget's code fails to compile or throws while rendering
    Then the card shows a warning the member can hover to read what went wrong
    And the frame is not restarted, because the code itself is the cause

  @integration
  Scenario: Every chart on the dashboard refreshes on a schedule
    Given auto-refresh is set to every minute
    When a minute passes with the tab visible
    Then every dashboard widget re-runs its queries against the current period
    And builder graphs and placed charts on the same dashboard refresh too

  @integration
  Scenario: Auto-refresh pauses while the tab is hidden and catches up on return
    Given auto-refresh is set to every minute
    When the tab is hidden for several minutes
    Then no refresh runs while it is hidden
    And the dashboard refreshes immediately when the tab is visible again

  @integration
  Scenario: The auto-refresh choice is remembered
    When the member sets auto-refresh to every 5 minutes
    And comes back to the dashboard later
    Then auto-refresh is still every 5 minutes
    And choosing off stops scheduled refreshes
