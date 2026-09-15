Feature: Visual diff between two refs
  As an engineer landing a large refactor
  I want to see every route and every flow rendered on both refs side by side
  So that a screen that lost behaviour is a finding rather than a surprise in production

  # The tool is `visualdiff` (tools/visualdiff, cmd/visualdiff): a Go CLI that
  # boots two refs and a Node runner (@langwatch/visual-diff-runner) that drives
  # Playwright against both. The route list and the flow list live in
  # visualdiff.yaml at the repository root, so extending the coverage is editing
  # YAML rather than editing the tool.

  Background:
    Given a repository checkout with a visualdiff.yaml

  # ---------------------------------------------------------------- the run

  @unit
  Scenario: A run boots both refs on ports that cannot collide
    Given a base ref and a candidate ref
    When the run plans the two stacks
    Then each ref gets its own browser port, API port and worker port
    And no port is shared between the two stacks

  @unit
  Scenario: A run waits for both stacks to answer before it captures anything
    Given both stacks have been started
    When the run waits for readiness
    Then it polls each listener until it answers
    And it fails with the boot timeout when a listener never answers

  @unit
  Scenario: A ref on the monolith layout boots with the migration steps skipped
    Given the base ref still keeps the application under platform/app
    When the run composes that stack's environment
    Then the Prisma, ClickHouse and provisioning steps are skipped for it
    And the shared database is left exactly as the run found it

  @unit
  Scenario: A run seeds its fixtures through the candidate API
    Given both stacks are healthy
    When the run seeds its fixtures
    Then a trace and a dataset are created through the candidate API with the project key
    And both stacks read those fixtures from the shared database

  @unit
  Scenario: A run captures the route list and the flow list on both refs
    Given a visualdiff.yaml listing routes and flows
    When the run drives the runner
    Then every route is captured on both refs
    And every flow step is captured on both refs

  @unit
  Scenario: A run diffs the captures and writes a report
    Given captures from both refs
    When the run builds the report
    Then it writes an HTML page, a findings.md and a findings.json
    And each row carries both screenshots, the diff ratio, the console errors and the failed requests

  @unit
  Scenario: A run tears its stacks down even when a step fails
    Given a run whose capture step fails
    When the run finishes
    Then both stacks are killed by process group
    And both worktrees are removed

  @unit
  Scenario: Teardown reports a port it could not free
    Given a stack whose port is still held after the kill
    When teardown verifies the ports
    Then it reports the port that is still listening

  @unit
  Scenario: A run exits 0 with no findings, 1 with findings and 2 on an operational failure
    Given a completed run
    When the exit status is decided
    Then no findings exits 0
    And findings exit 1
    And a boot or teardown failure exits 2

  @unit
  Scenario: A dry run prints the plan and starts nothing
    Given a base ref and a candidate ref
    When the run is asked for a dry run
    Then it prints the two stacks, their ports, the route count and the flow list
    And no worktree is created

  @unit
  Scenario: An unknown action in visualdiff.yaml is refused before anything boots
    Given a flow step naming an action the runner does not implement
    When the configuration is loaded
    Then the run fails naming the unknown action

  # ------------------------------------------------------- classification

  @unit
  Scenario: A route missing on the base and present on the candidate is an intended restore
    Given the base returns a not-found page and the candidate renders the screen
    When the row is classified
    Then it is classified as an intended restore

  @unit
  Scenario: A candidate console 404 on an API call is a restore gap
    Given the candidate records a 404 on an /api/ request the base does not
    When the row is classified
    Then it is classified as a restore gap

  @unit
  Scenario: A candidate page error is a regression
    Given the candidate throws where the base does not
    When the row is classified
    Then it is classified as a regression

  @unit
  Scenario: A small diff with no errors is noise
    Given the two screenshots differ by under two per cent with no console errors
    When the row is classified
    Then it is classified as noise

  # -------------------------------------------------------------- runner

  @unit
  Scenario: The runner settles on the in-flight request count rather than a fixed wait
    Given a page with requests in flight
    When the runner settles
    Then it waits for the in-flight count to reach zero and stay there for the quiet window
    And it gives up at the settle deadline rather than hanging

  @unit
  Scenario: The runner ignores server-sent events and Vite hot updates while settling
    Given an open event stream and a Vite hot-update request
    When the runner counts in-flight requests
    Then neither request is counted
    And a normal API request is counted

  @unit
  Scenario: A flow step that fails on one side is a finding
    Given a step that succeeds on the base and throws on the candidate
    When the runner reports that step
    Then the step is reported as a one-sided failure
    And a step that fails on both sides is not

  @unit
  Scenario: Console errors and failed requests are recorded per step
    Given a step that logs a console error and gets a 500
    When the runner reports that step
    Then both are attached to that step and not to the next one

  @unit
  Scenario: The viewport is configurable
    Given a run asking for a 390x844 viewport
    When the runner opens its browser contexts
    Then both sides use that viewport
