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

  Rule: a wrapper prints no note about output it does not have

    # A coding agent sets a variable such as CLAUDECODE in its children, and
    # the CLI reads that as agent mode. A command that still prints a human
    # table then notes on stderr that the table is not machine-readable. A
    # wrapper prints no table, it hands the terminal to the tool it runs.
    @unit
    Scenario: A wrapper run inside a coding agent prints no table note
      Given the CLI detects agent mode from the environment
      When `langwatch claude`, `codex`, `copilot`, `code`, `cursor`, `gemini` or `opencode` runs
      Then nothing about a table that is not machine-readable is printed
