# The attached viewer today is one tab per supervised lane over the capture
# files. Two lanes host two applications each (backend: api and worker; go:
# gateway and nlp), and nothing in the viewer reads the observability stack the
# same machine runs. This is the tab model that replaces it. Scroll, search and
# follow behaviour stays as specs/setup/haven-up-viewer.feature records.
#
# Bound by Go tests in tools/thuishaven (`go test ./cmd/... ./app/...`),
# annotated `// @scenario`. Every datasource has a memory double, so no
# scenario needs a running stack.

Feature: haven up viewer tabs
  As a developer watching a stack
  I want session, logs, errors, traces, metrics, profiles, stores and jobs as tabs
  So that the one screen I keep open answers the question I have

  Background:
    Given a worktree with a registered haven stack

  Rule: The top row is fixed and each tab is one datasource

    @unit
    Scenario: The tabs are session, logs, errors, traces, metrics, profiles, stores, jobs
      When the viewer opens
      Then the top row shows exactly those tabs in that order, numbered for direct jumps
      And left, right, tab and the digit keys move between them as before

    @unit
    Scenario: A Grafana-backed tab says so when the stack is down
      Given the observability stack is not running
      When traces, metrics or profiles is selected
      Then the body is one line naming the stack as down and the command that starts it
      And nothing is polled

    @unit
    Scenario: Only the visible tab polls
      Given the traces tab polls every five seconds
      When the developer switches to logs
      Then the traces poll stops until the tab is visible again

    @unit
    Scenario: Every tab has a plain form for agents
      When "haven <tab> --json" is run for any tab
      Then it prints the same rows the tab renders, as JSON, and exits

  Rule: Logs splits a lane by the application that wrote the line

    @unit
    Scenario: The logs sub-tabs are the applications, not the lanes
      When the logs tab opens
      Then its sub-tabs are all, ui, api, worker, gateway, nlp, langy, idp, design-system, mail-room, tasks and obs
      And a sub-tab appears only when its application has written a line

    @unit
    Scenario: A backend line lands under api or worker by its name field
      Given the backend lane wrote a structured line whose name is "langwatch:worker:clickhouse"
      When the logs tab is read
      Then the line is under worker and not under api
      And a line whose name starts with "langwatch:api" is under api

    @unit
    Scenario: A go line lands under gateway or nlp by its service field
      Given the go lane wrote a structured line whose service is "langwatch-service-nlpgo"
      Then the line is under nlp

    @unit
    Scenario: An unstructured line stays with its lane's default application
      Given the backend lane wrote a stack frame with no name field
      Then the line follows the last structured line's application on that lane

    @unit
    Scenario: Level keys narrow the stream
      When the developer presses w
      Then only warn and above are shown, and the footer says so
      And e shows error and above, and a again shows everything

    @unit
    Scenario: The muted console is named and Loki is one key away
      Given the observability stack is up, so the console is muted to warn and above
      When the logs tab opens
      Then the footer says that info and debug lines are in Loki
      And pressing L switches the sub-tab's source to Loki for this worktree's slug, and again switches back

  Rule: Errors groups the last distinct failures across every lane

    @unit
    Scenario: Errors are grouped by signature
      Given the backend lane logged the same RepositoryOwnershipConflictError on eleven restarts
      When the errors tab opens
      Then there is one row with a count of 11, its first and last seen times and the lane
      And enter shows the full message and stack of the last occurrence

    @unit
    Scenario: Errors are ordered by last seen
      Given two distinct errors
      Then the one seen most recently is on top

  Rule: Traces, metrics and profiles read this worktree's data from the observability stack

    @unit
    Scenario: Traces lists this stack's recent root spans
      Given Tempo holds root spans from two worktrees
      When the traces tab opens
      Then only spans whose worktree attribute is this stack's slug are listed
      And each row shows time, service, root span name, duration and status, newest first

    @unit
    Scenario: A trace opens as an indented span tree, and in Grafana
      When the developer presses enter on a trace
      Then the body is the span tree with each span's name, service and duration, indented by depth
      And o opens the same trace in Grafana in the browser

    @unit
    Scenario: Errors-only toggles the trace list
      When the developer presses e on the traces tab
      Then only traces whose root span has error status are listed

    @unit
    Scenario: Metrics is a fixed panel, not a query box
      When the metrics tab opens
      Then it shows request rate and p95 per application, worker queue depth and blocked jobs,
        ClickHouse statement concurrency, and RSS and CPU per lane
      And each is a label, the current value and a text sparkline of the last ten minutes

    @unit
    Scenario: Profiles shows the top functions per service
      When the profiles tab opens
      Then for each Node and Go service it lists the ten functions with the most CPU and the most heap over the last ten minutes
      And o opens the flame graph for the selected service in Grafana

  Rule: Stores and jobs read what haven already manages

    @unit
    Scenario: Stores shows each server against its limit
      When the stores tab opens
      Then Postgres shows connections in use against the pool
      And Redis shows memory used against its cap
      And ClickHouse shows memory used against the server limit
      And a value past ninety percent of its limit is marked

    @unit
    Scenario: Jobs is the history of the one-shot lanes
      Given prepare, seed and an image pull ran during this up
      When the jobs tab opens
      Then each is a row with its name, when it ran, how long it took and its exit
      And enter shows that job's captured output

  Rule: Wide lines are cut, not wrapped, and expand on demand

    @unit
    Scenario: A line wider than the terminal is cut, not wrapped
      Given a rendered line wider than the terminal
      When the viewer draws it
      Then it stays one row, cut to the width, with a dim marker where it was cut
      And a line that fits carries no marker

    @unit
    Scenario: Clicking a row opens it in full, and clicking again closes it
      When the developer clicks a cut row
      Then that row alone is shown in full, wrapped under the message column
      And clicking it again cuts it back to one row

    @unit
    Scenario: x opens every row on the tab, for a terminal that forwards no clicks
      When the developer presses x
      Then every row on the tab is shown in full
      And the setting belongs to that tab, and x again cuts them back
