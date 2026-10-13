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

  # ---------------------------------------------------------------------------
  # Every LangWatchQL query runs under one restricted database identity that
  # may run a fixed number of statements at once. A dashboard asked for all of
  # its widgets' queries in the same instant, on load and on every refresh, so
  # some were refused. The refusal had no code, reached the page as an unknown
  # error, and the widget's data hook dropped the chart it was already showing.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A busy query service is a named, retryable refusal
    Given the LangWatchQL identity is already running as many statements as it may
    When another query arrives and the database refuses it
    Then the caller receives "lwql_busy", a platform fault marked retryable
    And it is not reported as an unknown error

  @integration
  Scenario: The frame is told when a failed query is worth retrying
    Given a widget's query is refused with a retryable error
    When the page answers the frame
    Then the error the frame receives is marked retryable
    And an error that is not retryable carries no such mark

  @unit
  Scenario: A failed refresh keeps the chart that was on screen
    Given a widget's query has loaded rows
    When a later refetch of it fails
    Then the widget still holds the same rows and is not in an error state
    And the failure is reported apart, as a refetch error

  @unit
  Scenario: A retryable failure is retried with backoff before it counts
    Given a widget's query is refused with a retryable error
    When the data hook handles the refusal
    Then it tries again up to three times, waiting longer each time, with jitter
    And a retry that succeeds leaves no error behind
    And a failure that is not marked retryable is not retried

  @unit
  Scenario: An error state is only for a query that never had data
    Given a widget's query has never loaded rows
    When it fails and its retries are spent
    Then the widget is in an error state carrying that failure

  @unit
  Scenario: A dashboard does not send every widget query at once
    Given the widgets on a page ask for more queries than the page runs at a time
    When they all ask in the same instant
    Then at most four run at once and the rest start as earlier ones finish
    And a query whose frame is torn down while it waits never starts
