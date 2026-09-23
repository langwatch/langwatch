Feature: Chart CI lifecycle and e2e matrix
  Shipping chart-heavy work stalled because the e2e leg was one serial job that
  hid failures behind the first one to break and cost a 35-minute round trip per
  mistake, while the Helm lifecycle invariants a review bot re-derived by eye
  every round were checkable in seconds. tasks#894 encodes those invariants and
  splits the e2e leg into independent, parallel legs that share one image build.

  AC1's lifecycle-invariant scenarios live alongside these and bind to
  charts/langwatch/tests/lifecycle.sh. The scenarios below (AC2-AC6) bind to
  charts/langwatch/tests/e2e.sh and charts/langwatch/tests/chart-workflow-matrix.sh.

  @regression
  Scenario: e2e.sh runs exactly the suites named as arguments (tasks#894)
    Given the chart e2e script e2e.sh
    When it is run with a list of suite names as arguments
    Then it runs exactly those suites, in the order given, and nothing else
    And run with no arguments it runs today's full suite list in today's order
    And an unknown suite name is a hard error with exit code 2, never a silent skip

  @e2e
  Scenario: The chart e2e runs core, external and overlays as independent matrix legs (tasks#894)
    Given the langwatch-chart workflow
    When the e2e job runs on a pull request
    Then it runs the legs core, external and overlays
    And each leg stands up its own kind cluster

  @e2e
  Scenario: A failing suite in one e2e leg does not stop the other legs (tasks#894)
    Given the e2e job split into independent matrix legs
    When a suite fails in one leg
    Then the strategy sets fail-fast to false so the other legs still run to completion

  @e2e
  Scenario: One build-images job builds each image once and the e2e legs load them (tasks#894)
    Given the app, gateway and clickhouse-serverless images the e2e legs install
    When the workflow runs
    Then a single build-images job builds each image once and publishes it as an artifact
    And every e2e leg loads the images it needs and rebuilds none of them

  @e2e
  Scenario: Every suite that runs on main runs in exactly one e2e leg (tasks#894)
    Given the full suite list e2e.sh runs on main
    When the legs' suite arguments are taken together
    Then every suite on main appears in exactly one leg, none dropped and none duplicated

  @e2e
  Scenario: No e2e suite is skipped, gated, or made optional (tasks#894)
    Given the langwatch-chart workflow
    When its jobs and steps are inspected
    Then no step is continue-on-error and no suite is gated behind an optional flag

  # Wall time is a property of a live pull_request run, cited by run id in the PR
  # body against 697s for the old single infra leg — there is no script that can
  # assert it, so it is tracked here rather than bound.
  @e2e @unimplemented
  Scenario: The slowest chart e2e leg finishes within the wall-time budget (tasks#894)
    Given the e2e legs run in parallel sharing one image build
    When the pull_request run completes
    Then the slowest chart e2e leg finishes within the wall-time budget for the PR head
