Feature: CI path filters skip unnecessary workflows on non-code changes
  As a developer
  I want CI to skip expensive workflows when only docs, specs, or config files change
  So that PR feedback is faster and CI minutes are not wasted

  Background:
    Given a workflow filtered out by "on.paths" never reports a status at all
    And a required status check that never reports blocks the pull request forever
    And so a workflow whose aggregator is required must run unconditionally instead

  # ============================================================================
  # Two ways to skip work, and which one a workflow is allowed to use
  # ============================================================================
  #
  # The "-unmodified" stub pairs this spec used to describe are gone. They were
  # replaced (#3223) by "always run, gate internally, report through an
  # alls-green aggregator", because a stub that drifts from its real workflow's
  # job names is a silently unsatisfiable required check.
  #
  # That pattern costs a runner lease to decide "nothing to do". Workflows with
  # no required check avoid the lease entirely by filtering in "on:", which
  # GitHub evaluates before allocating anything.

  Scenario: A workflow whose aggregator is required runs on every pull request
    Given the ruleset requires that workflow's "-complete" check
    When a pull request touches none of the paths it cares about
    Then the workflow still runs
    And its real jobs are skipped
    And its aggregator reports success, so the required check resolves

  @unit
  Scenario: A workflow that filters in on.paths declares no aggregator
    Given a workflow declares "on.pull_request.paths"
    When it also declares a job whose name ends in "-complete"
    Then the path-filter guard fails
    And it says the aggregator and the filter contradict each other

  @unit
  Scenario: A path filter covers every path the workflow's gate consults
    Given a workflow keeps an internal gate for per-job filters
    And it also declares "on.pull_request.paths"
    When the gate filters on a path the "on.paths" list does not cover
    Then the path-filter guard fails
    And it names the uncovered path
    And it says the job that filter guards would silently not run

  @unit
  Scenario: A push filter is not treated as a pull-request filter
    Given a workflow declares "paths" under "push" but not under "pull_request"
    Then the path-filter guard does not treat it as filtered

  Scenario: CodeQL skips docs-only PRs
    When a PR changes only files in docs/, .claude/, specs/, or markdown files
    Then codeql.yml does not run its analysis
    And its aggregator still reports success for the required check

  Scenario: Push to main always runs all workflows
    When a commit is pushed to the main branch
    Then all workflows run regardless of which files changed

  # ============================================================================
  # Live ingest coverage
  # ============================================================================

  @unit
  Scenario: A change to the app's HTTP ingest spine runs the SDK end-to-end job
    Given the SDK end-to-end job is the only check that posts real telemetry to a running server
    When a PR changes the app's ingest routes, their router, their OpenTelemetry body reader, or the server entrypoint
    Then the SDK end-to-end job runs even though no SDK file changed

  @unit
  Scenario: A change to the app's HTTP ingest spine does not run the paid SDK test job
    Given the SDK test job drives live model traffic through the AI Gateway
    When a PR changes app code and no SDK file
    Then the SDK test job stays skipped

  @unit
  Scenario: Every path filter the SDK workflow reads is declared by the change detector
    Given the change detector exposes only the outputs it declares
    And an undeclared output reads as an empty string rather than failing
    When the SDK workflow gates a job on a path filter
    Then that filter is declared as an output of the change detector and forced true on non-diff events

  # ============================================================================
  # Dependency scanners are path-gated, secret and SAST scanners are not
  # ============================================================================

  Scenario: A PR with no Go changes does not run the Go advisory scanner
    When a PR changes no Go source and no Go module manifest
    Then govulncheck does not run
    And gitleaks, trufflehog and semgrep still run

  Scenario: A PR with no Python manifest changes does not run the Python advisory scanner
    When a PR changes no requirements file and no pyproject
    Then pip-audit does not run
    And gitleaks, trufflehog and semgrep still run

  Scenario: The scheduled scan runs every scanner
    When the weekly code-scanners cron fires
    Then govulncheck and pip-audit both run regardless of which files changed

  Scenario: A merge queue entry runs every scanner
    When a change enters the merge queue
    Then govulncheck and pip-audit both run regardless of which files changed

  # ============================================================================
  # Safety invariants
  # ============================================================================

  Scenario: No PR is permanently blocked by missing status checks
    Given every required check is a "-complete" aggregator on an always-run workflow
    When any combination of files is changed in a PR
    Then every required status check receives a result
