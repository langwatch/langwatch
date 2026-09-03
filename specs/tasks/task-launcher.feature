Feature: The task launcher

  One interface runs every one-shot program in the system — a migration, a
  backfill, a provisioning step, a document generator — from the same
  command line on a laptop and inside the container image. A task is
  resolved by name from a catalogue, run to completion or failure, and the
  process always closes its handles before it exits.

  @unit
  Scenario: A task runs by name with its arguments
    Given a catalogue that registers a task named "webhook-signature-vectors"
    When the launcher is run with that name and a list of arguments
    Then the task's run method receives exactly those arguments
    And the launcher logs the task name when it starts and its duration when it finishes
    And the launcher returns exit code 0

  @unit
  Scenario: An unknown task name lists the available names and exits non-zero
    Given a catalogue that registers one or more tasks
    When the launcher is run with a name that is not in the catalogue
    Then the launcher logs the catalogue's task names
    And the launcher returns a non-zero exit code
    And no task is run

  @unit
  Scenario: A task that throws exits non-zero with one logged failure line and closes the host
    Given a catalogue that registers a task whose run method throws
    When the launcher runs that task
    Then exactly one error line is logged for the failure
    And the launcher returns a non-zero exit code
    And the host's close function is awaited exactly once

  @unit
  Scenario: A task whose infrastructure handle is absent refuses by name
    Given a TaskHostPort composed without a ClickHouse handle
    When a task calls requireClickhouse on that host
    Then it throws a HandledError with code task_infrastructure_unavailable
    And the error names the missing handle, not a stack trace through a null client

  @integration
  Scenario: The same command line works from a laptop and from the container CMD
    Given the apps/tasks package script "task"
    When it is invoked locally as `pnpm --filter @langwatch/tasks task webhook-signature-vectors`
    And it is invoked inside the container as `pnpm -s task webhook-signature-vectors`
    Then both invocations resolve the same catalogue entry and run the same task
