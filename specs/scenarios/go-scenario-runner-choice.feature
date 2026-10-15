Feature: A worker picks the Go scenario runner or the Node scenario child per run

  The worker image ships the Go scenario runner (`services/scenariorunner`) as its own binary
  beside the Node scenario child. A project-scoped feature flag,
  `release_scenario_go_runner_enabled`, off by default, moves that project's runs onto the Go
  runner. The Go runner is spawned exactly as the Node child is: the same allow-listed
  environment, the same job on stdin and the same last result line on stdout. It runs with the
  same rights as the Node child, so its outbound fence matches the Node child's, redirects
  included (refused, never followed).

  Background:
    Given a worker composed with a scenario executor

  Rule: The flag decides, voice never moves

    @unit
    Scenario: A run starts on the Node child while the flag is off
      Given the project's Go runner flag is off
      When a run for an HTTP target starts
      Then the Node scenario child is spawned
      And the Go runner is not

    @unit
    Scenario: A run starts on the Go runner while the flag is on
      Given the project's Go runner flag is on
      And the Go runner's binary is on disk
      When a run for an HTTP target starts
      Then the Go runner is spawned with the same job data and environment

    @unit
    Scenario: A voice run stays on the Node child whatever the flag says
      Given the project's Go runner flag is on
      And the Go runner's binary is on disk
      When a run for a voice target starts
      Then the Node scenario child is spawned
      And the flag is not read

    @unit
    Scenario: A flag read that fails keeps the run on the Node child
      Given the project's Go runner flag cannot be read
      When a run for an HTTP target starts
      Then the Node scenario child is spawned

  Rule: A worker without the binary keeps every run on Node

    @unit
    Scenario: A missing binary falls back to the Node child and is looked for once
      Given the project's Go runner flag is on
      And the Go runner's binary is not on disk
      When two runs for an HTTP target start
      Then both start on the Node scenario child
      And the binary is looked for only once, so its warning is logged once

    @unit
    Scenario: A worker that names no binary keeps runs on the Node child
      Given the project's Go runner flag is on
      And the worker's configuration names no Go runner binary
      When a run for an HTTP target starts
      Then the Node scenario child is spawned

  Rule: The Go runner is started with the Node child's environment and nothing else

    @unit
    Scenario: A worker secret in the parent's environment never reaches the Go runner
      Given the worker process holds a secret in its own environment
      When the Go runner is spawned for a run
      Then the runner's environment holds only the Node child's allow-listed variables
      And the secret is not among them

    @unit
    Scenario: The Go runner's result line is read like the Node child's
      Given the Go runner writes its result as its last stdout line and exits
      When the run completes
      Then the parent reads the result with the same parser as the Node child's

  Rule: The worker image carries the binary

    @unit
    Scenario: The image builds the runner in its own Go stage and names its path to the worker
      Given the worker image's Dockerfile
      Then a Go stage builds services/scenariorunner with CGO disabled as its own binary
      And the runtime stage copies it in and names its path in SCENARIO_GO_RUNNER_PATH
