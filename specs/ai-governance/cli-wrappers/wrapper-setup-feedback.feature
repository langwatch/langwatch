Feature: The wrapper shows progress while it sets up telemetry

  Between the path choice and the launch, `langwatch <tool>` can reach the
  control plane: it confirms the cached ingest key is still live, and after
  a logout it mints a fresh one. That work used to run in silence right
  after the "langwatch saved" line, long enough to read as a hang and make
  the user reach for Ctrl+C.

  Rule: network setup is never silent

    @unit
    Scenario: Telemetry setup shows a spinner while it runs
      Given `langwatch claude` setting up telemetry for the tool
      When the setup is in flight
      Then a spinner says telemetry is being set up for that tool
      And the spinner is gone before the wrapper prints its feedback lines

    @unit
    Scenario: The spinner is gone before an error is reported
      Given `langwatch claude` setting up telemetry for the tool
      When the setup fails
      Then the spinner is stopped before the failure is printed
