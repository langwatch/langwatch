@unit
Feature: haven logs
  Every service's output is captured per-service whether the stack is
  attached or detached, so logs can be replayed, followed, and filtered
  from any terminal — no detach flag to have remembered, no grepping a
  giant combined file, no query language. See ADR-064.

  Background:
    Given a worktree with a registered haven stack

  Scenario: Logs are captured no matter how the stack was started
    Given the stack was started attached in another terminal
    When the developer runs "haven logs" from a new terminal
    Then recent output from every service appears

  Scenario: Everything, labelled and interleaved
    When the developer runs "haven logs"
    Then recent lines from all services print in time order
    And every line is labelled with its service
    And warnings and errors are visually distinct

  # Every child writes the same structured JSON in every environment, and the
  # terminal rendering lives in one place instead of in eight pretty consoles.
  # See dev/docs/best_practices/dev-log-format.md.
  Scenario: One rendering, whatever the service logs with
    Given services that log through different libraries
    When the developer runs "haven logs"
    Then every line shows the time, the service and the level in the same fixed columns
    And a line that is not structured keeps the service column and reads unchanged
    And an error's stack trace is indented under the line it belongs to
    And a message carrying its own newlines is inset under the column it started at
    And an embedded payload keeps the indentation its own structure is written in
    And a serialised error the message already reads out is shortened to what it alone adds
    And a stack whose opening repeats a message of several lines is read out once, keeping its frames

  Scenario: The raw bytes are one flag away
    When the developer runs "haven logs --raw"
    Then each line is exactly what the service wrote, unrendered

  Scenario: A machine consumer gets one object per line
    When the developer runs "haven logs --json"
    Then every line is a JSON object carrying the service it came from
    And a line that was not structured is still emitted as an object

  Scenario: Filtering to one service is a plain argument
    When the developer runs "haven logs nlp"
    Then only nlp's lines appear
    And "haven logs nlp gateway" combines the two

  # The api lane hosts the API and the worker in one Node process (ADR-004,
  # amendment 2026-09-07), so one capture file holds both. A worker that refuses
  # to boot otherwise reads as "the api failed", which is the half of the
  # diagnosis that does not say which application to go and look at.
  Scenario: The two applications the api lane hosts are addressable by name
    When the developer runs "haven logs worker"
    Then only the lines the worker application wrote appear
    And "haven logs api" shows only the API application's lines
    And "haven logs api worker" combines the two, each labelled with its own name
    And naming a service that does not exist lists api and worker among the choices
    And a capture written when the lane was called "backend" is still found

  Scenario: The api lane is still readable whole
    When the developer runs "haven logs"
    Then the api lane's lines appear under the lane's own name
    And the launcher's own lines, which belong to neither half, are among them

  # The dashboard's list is what a person selects from, so anything it reports
  # has to be in it. Reporting the shared machinery on a line of its own as
  # well said everything twice and left half of it unreachable.
  Scenario: One list, and everything in it can be selected
    When the developer opens the session dashboard
    Then the browser application, the api and the worker lead the list
    And the machine-wide machinery is listed after this stack's own children
    And a server this stack merely routes to appears once, not once per listing
    And a row with no URL of its own still says where it is reached
    And selecting machine-wide machinery reads it but never offers to bounce it

  # A stack serving pages with a dead worker looks healthy from every row but
  # the worker's, and the logs page is where a person already is when they are
  # asking why nothing happened.
  Scenario: A log sub-tab carries the health of the application behind it
    When the developer opens the logs page
    Then each application's sub-tab is marked green when it answers and red when it does not
    And a sub-tab haven supervises nothing behind carries no mark at all
    And the mark on the api sub-tab reads the lane, not the routed api hostname

  @integration @unimplemented
  Scenario: Tailing is -t and only -t
    When the developer runs "haven logs -t"
    Then output streams live until interrupted
    And "-t" means tail nowhere else and nothing else in the CLI

  Scenario: A time window is one flag
    When the developer runs "haven logs --since 10m"
    Then only lines from the last ten minutes appear

  Scenario: Severity is a filter, not a grep
    When the developer runs "haven logs --level warn"
    Then only lines at warn or above appear

  @integration @unimplemented
  Scenario: Another stack's logs by name
    When the developer runs "haven logs --stack otherslug"
    Then that worktree's services print instead of this one's

  Scenario: Logs outlive the stack
    Given the stack was stopped or crashed
    When the developer runs "haven logs"
    Then the last run's output is still readable

  @integration @unimplemented
  Scenario: The observability stack is a log target like any other
    When the developer runs "haven logs obs"
    Then the observability stack's container output appears

  Scenario: One unreadable line never ends the capture
    Given a service that prints a single line of several megabytes
    When the supervisor captures its output
    Then the long line is split across captured lines instead of dropped
    And the lines printed after it are still captured
    And the service is never blocked writing to a pipe with no reader

  Scenario: A read error is recorded, not swallowed
    Given the supervisor cannot read a service's output stream
    When the read fails
    Then the failure is written to that service's log
    And everything read before the failure is kept

  Scenario: Capture comes back after the log file cannot be written
    Given the log directory is momentarily unwritable
    When the service keeps printing
    Then capture retries the file instead of giving up for the life of the process
    And a rotation that cannot happen keeps appending past the cap rather than going silent

  Scenario: Log files never grow without bound
    Given a service that logs heavily for days
    Then its captured log stays within the per-service size cap

  # Rotation bounds the file; this bounds the read, and they are not the same
  # thing. One generation of a busy service is still far larger than any view
  # of it, and the default view is the last 200 lines. Bound by cmd/logs_test.go.
  Scenario: A huge capture is read from its tail, not whole
    Given a captured log far larger than the command will ever print
    When the developer runs "haven logs"
    Then only the tail of the capture is read into memory
    And the newest lines still appear
    And a following tail resumes from the end of the file, not the end of what was read
    And the developer is told that older history was elided

  # The browser viewer, which reads the same captures this feature describes.
  # It could fetch and filter, but not answer the question you open it with:
  # severity was a dropdown of floors — "warnings and errors" — so a warning
  # could never be read without errors mixed into it, and nothing on the page
  # said how many of either there were.

  @unit
  Scenario: Severity is a row of counted chips, not a dropdown of floors
    Given captured output holding errors, warnings and information
    When the viewer draws its severity control
    Then each severity is a chip carrying its own count, worst first
    And switching one off hides those lines while its count still says how many were hidden

  @unit
  Scenario: A search says where it matched, not only which lines it kept
    Given a filter that matches inside a line
    When the lines are drawn
    Then the matching text is marked within the line
    And a captured line is written as text, so output containing markup renders as the characters it is

  @unit
  Scenario: The log viewer is driven from the keyboard
    When a developer presses slash anywhere on the dashboard
    Then the log filter takes focus, and escape clears it
    And the shortcut stands down while something else is being typed into
